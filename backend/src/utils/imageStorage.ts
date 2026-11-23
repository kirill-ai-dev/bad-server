import { randomUUID } from 'crypto'
import { lstat, mkdir, readdir, rename, unlink, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import Product from '../models/product'
import BadRequestError from '../errors/bad-request-error'

const managedName =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i
let queue: Promise<unknown> = Promise.resolve()
export function withImageStorageLock<T>(
    operation: () => Promise<T>
): Promise<T> {
    const pending = queue.then(operation)
    queue = pending.catch(() => undefined)
    return pending
}
function directories() {
    const root = resolve(
        process.env.IMAGE_STORAGE_ROOT || join(__dirname, '../public')
    )
    const folder = (value: string) => {
        if (!/^[a-zA-Z0-9_-]+$/.test(value))
            throw new Error('Invalid image directory')
        return join(root, value)
    }
    const temp = folder(process.env.UPLOAD_PATH_TEMP || 'temp')
    const permanent = folder(process.env.UPLOAD_PATH || 'images')
    if (temp === permanent)
        throw new Error('Image directories must be distinct')
    return { temp, permanent }
}
function imageName(value: string): string {
    const prefix = `/${process.env.UPLOAD_PATH || 'images'}/`
    const name = value.startsWith(prefix) ? value.slice(prefix.length) : ''
    if (!managedName.test(name))
        throw new BadRequestError('Недопустимое имя изображения')
    return name
}
async function regularFile(file: string) {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink())
        throw new BadRequestError('Недопустимый файл')
    return info
}
async function removeIfPresent(file: string) {
    try {
        await regularFile(file)
        await unlink(file)
    } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') throw error
    }
}
async function cleanupUnlocked() {
    const dirs = directories()
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    await Promise.all([
        mkdir(dirs.temp, { recursive: true }),
        mkdir(dirs.permanent, { recursive: true }),
    ])
    const referenced = new Set(await Product.distinct('image.fileName'))
    await Promise.all(
        [dirs.temp, dirs.permanent].map(async (directory) => {
            const names = await readdir(directory)
            await Promise.all(
                names.map(async (name) => {
                    if (!managedName.test(name)) return
                    const file = join(directory, name)
                    const info = await lstat(file)
                    if (
                        !info.isFile() ||
                        info.isSymbolicLink() ||
                        info.mtimeMs >= cutoff
                    )
                        return
                    if (
                        directory === dirs.permanent &&
                        referenced.has(
                            `/${process.env.UPLOAD_PATH || 'images'}/${name}`
                        )
                    )
                        return
                    await unlink(file)
                })
            )
        })
    )
}
export const cleanupImages = () => withImageStorageLock(cleanupUnlocked)
export async function storeImage(data: Buffer): Promise<string> {
    await cleanupUnlocked()
    const dirs = directories()
    let fileCount = 0
    const sizes = await Promise.all(
        [dirs.temp, dirs.permanent].map(async (directory) => {
            const entries = await readdir(directory)
            fileCount += entries.length
            const info = await Promise.all(
                entries.map((name) => lstat(join(directory, name)))
            )
            return info.reduce(
                (total, entry) => total + (entry.isFile() ? entry.size : 0),
                0
            )
        })
    )
    const used = sizes.reduce((total, size) => total + size, 0)
    const quota = Number(
        process.env.IMAGE_STORAGE_MAX_BYTES || 256 * 1024 * 1024
    )
    if (
        !Number.isSafeInteger(quota) ||
        quota < 1 ||
        fileCount >= 10000 ||
        used + data.length > quota
    )
        throw new BadRequestError('Лимит хранилища изображений исчерпан')
    const name = `${randomUUID()}.png`
    await writeFile(join(dirs.temp, name), data, { flag: 'wx' })
    return `/${process.env.UPLOAD_PATH || 'images'}/${name}`
}
export async function stageImage(value: string) {
    const name = imageName(value)
    const dirs = directories()
    await mkdir(dirs.permanent, { recursive: true })
    const from = join(dirs.temp, name)
    const to = join(dirs.permanent, name)
    try {
        await regularFile(from)
        await rename(from, to)
    } catch (_error) {
        throw new BadRequestError('Изображение не найдено среди загрузок')
    }
    return {
        rollback: async () => {
            await rename(to, from)
        },
    }
}
export async function removeUnreferencedImage(value: string) {
    let name: string
    try {
        name = imageName(value)
    } catch (_error) {
        return
    }
    if (!(await Product.exists({ 'image.fileName': value })))
        await removeIfPresent(join(directories().permanent, name))
}
