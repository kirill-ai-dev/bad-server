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
    // The signed double-submit cookie itself is the browser/session binding.
    // Keep this compatible with API clients that forward only _csrf.
    getSessionIdentifier: () => '',
    cookieName: '_csrf',
    cookieOptions,
    getCsrfTokenFromRequest: (req) => req.get('X-CSRF-Token'),
})
export const csrfToken = (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')
    res.json({ csrfToken: generateCsrfToken(_req, res) })
}
export default doubleCsrfProtection
