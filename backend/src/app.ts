import cookieParser from 'cookie-parser'
import cors from 'cors'
import 'dotenv/config'
import express, { json, urlencoded } from 'express'
import mongoose from 'mongoose'
import path from 'path'
import helmet from 'helmet'
import { rateLimit, MemoryStore } from 'express-rate-limit'
import { DB_ADDRESS, PORT, trustProxy } from './config'
import errorHandler from './middlewares/error-handler'
import csrfProtection from './middlewares/csrf'
import serveStatic from './middlewares/serverStatic'
import routes from './routes'
import { cleanupImages } from './utils/imageStorage'

export const rateLimitStore = new MemoryStore()
export const authRateLimitStore = new MemoryStore()
const app = express()
app.disable('x-powered-by')
app.set('trust proxy', trustProxy)
app.set('query parser', 'extended')
app.use(helmet({ strictTransportSecurity: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(
    cors({
        origin: process.env.ORIGIN_ALLOW || 'http://localhost:5173',
        credentials: true,
    })
)
app.use(
    rateLimit({
        store: rateLimitStore,
        windowMs: 10 * 1000,
        limit: 40,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { message: 'Слишком много запросов. Повторите позже' },
    })
)
app.use(cookieParser())
const noStore = (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.set('Cache-Control', 'no-store')
    next()
}
app.use('/auth', noStore)
app.use('/order', noStore)
app.use('/customers', noStore)
app.use(['/auth/login', '/auth/register'], rateLimit({
    store: authRateLimitStore,
    windowMs: 60 * 1000,
    limit: 20,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Слишком много попыток авторизации. Повторите позже' },
}))
app.use(serveStatic(path.join(__dirname, 'public')))
app.use(urlencoded({ extended: false, limit: '100kb', parameterLimit: 50 }))
app.use(json({ limit: '100kb' }))
app.use(csrfProtection)
app.use(routes)
app.use(errorHandler)

export default app
if (require.main === module) {
    mongoose
        .connect(DB_ADDRESS)
        .then(() => {
            const cleanup = () => cleanupImages().catch(() => console.error('Не удалось очистить неиспользуемые изображения'))
            cleanup()
            setInterval(cleanup, 60 * 60 * 1000).unref()
            const server = app.listen(PORT)
            server.requestTimeout = 15000
            server.headersTimeout = 10000
        })
        .catch(() => {
            console.error('Не удалось подключиться к базе данных')
            process.exitCode = 1
        })
}
