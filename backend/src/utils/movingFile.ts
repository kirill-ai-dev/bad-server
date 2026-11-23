import { mkdir, rename } from 'fs/promises'
import { basename, join } from 'path'
import BadRequestError from '../errors/bad-request-error'

export default async function movingFile(
    imagePath: string,
    from: string,
    to: string
) {
    const fileName = basename(imagePath)
    if (!/^[a-zA-Z0-9_-]+\.(png|jpe?g|gif|webp|svg)$/.test(fileName))
        throw new BadRequestError('Недопустимое имя файла')
    await mkdir(to, { recursive: true })
    try {
        await rename(join(from, fileName), join(to, fileName))
    } catch (_error) {
        throw new BadRequestError(
            'Файл не найден среди загруженных изображений'
        )
    }
}
