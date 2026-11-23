import { isCelebrateError } from 'celebrate'
import { ErrorRequestHandler } from 'express'
import { Error as MongooseError } from 'mongoose'
import { MulterError } from 'multer'

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    let status = err.statusCode || err.status || 500
    if (
        isCelebrateError(err) ||
        err instanceof MongooseError.ValidationError ||
        err instanceof MongooseError.CastError
    )
        status = 400
    if (err instanceof MulterError)
        status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    const messages: Record<number, string> = {
        400: 'Некорректные данные запроса',
        401: 'Необходима авторизация',
        403: 'Доступ запрещён или CSRF-токен недействителен',
        404: 'Не найдено',
        409: 'Запись уже существует',
        413: 'Превышен допустимый размер данных',
    }
    if (status < 400 || status > 599) status = 500
    res.status(status).json({
        message: messages[status] || 'На сервере произошла ошибка',
    })
}
export default errorHandler
