import { Request, Response, NextFunction } from 'express'
import sharp from 'sharp'
import { storeImage, withImageStorageLock } from '../utils/imageStorage'
import BadRequestError from '../errors/bad-request-error'

export const uploadFile = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    if (!req.file || req.file.size <= 2048)
        return next(new BadRequestError('Недопустимый файл'))
    try {
        const data = await sharp(req.file.buffer, {
            limitInputPixels: 16000000,
        })
            .png()
            .toBuffer()
        if (data.length > 5 * 1024 * 1024)
            throw new BadRequestError(
                'Размер изображения после обработки превышен'
            )
        const fileName = await withImageStorageLock(() => storeImage(data))
        return res.status(201).json({
            fileName,
            originalName: req.file.originalname,
        })
    } catch (_error) {
        return next(new BadRequestError('Недопустимое изображение'))
    }
}
