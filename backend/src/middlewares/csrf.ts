import { randomBytes } from 'crypto'
import { doubleCsrf } from 'csrf-csrf'
import { Request, Response } from 'express'
import { CSRF_SECRET, secureCookies } from '../config'

const cookieOptions = {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax' as const,
    path: '/',
}
const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
    getSecret: () => CSRF_SECRET,
    getSessionIdentifier: (req) => req.cookies.csrfSession || '',
    cookieName: '_csrf',
    cookieOptions,
    getCsrfTokenFromRequest: (req) => req.get('X-CSRF-Token'),
})
export const csrfToken = (req: Request, res: Response) => {
    if (!req.cookies.csrfSession) {
        const session = randomBytes(32).toString('hex')
        res.cookie('csrfSession', session, cookieOptions)
        req.cookies.csrfSession = session
    }
    res.set('Cache-Control', 'no-store')
    res.json({ csrfToken: generateCsrfToken(req, res) })
}
export default doubleCsrfProtection
