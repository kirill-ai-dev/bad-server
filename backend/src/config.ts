import { randomBytes } from 'crypto'
import { isIP } from 'net'
import { CookieOptions } from 'express'
import ms, { StringValue } from 'ms'
import { SignOptions } from 'jsonwebtoken'

export const {
    PORT = '3000',
    DB_ADDRESS = 'mongodb://127.0.0.1:27017/weblarek',
} = process.env
export const secureCookies = process.env.COOKIE_SECURE === 'true'
if (process.env.NODE_ENV === 'production' && !secureCookies)
    throw new Error('COOKIE_SECURE=true is required in production')
// Trust exact proxy addresses only; direct development requests trust no forwarding headers.
export const trustedProxyIps = (process.env.TRUSTED_PROXIES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
if (trustedProxyIps.some((value) => !isIP(value)))
    throw new Error('TRUSTED_PROXIES must contain exact IP addresses')
export const trustProxy = (address: string, hop: number) =>
    hop === 0 && trustedProxyIps.includes(address.replace(/^::ffff:/, ''))
function secret(name: string): string {
    const value = process.env[name]
    if (value && value.length >= 32) return value
    if (process.env.NODE_ENV === 'production')
        throw new Error(`${name} must contain at least 32 characters`)
    return randomBytes(32).toString('hex')
}
export const CSRF_SECRET = secret('CSRF_SECRET')
export const ACCESS_TOKEN = {
    secret: secret('AUTH_ACCESS_TOKEN_SECRET'),
    expiry: (process.env.AUTH_ACCESS_TOKEN_EXPIRY ||
        '10m') as SignOptions['expiresIn'],
}
export const REFRESH_TOKEN = {
    secret: secret('AUTH_REFRESH_TOKEN_SECRET'),
    expiry: (process.env.AUTH_REFRESH_TOKEN_EXPIRY ||
        '7d') as SignOptions['expiresIn'],
    cookie: {
        name: 'refreshToken',
        options: {
            httpOnly: true,
            sameSite: 'lax',
            secure: secureCookies,
            maxAge: Number(ms((process.env.AUTH_REFRESH_TOKEN_EXPIRY || '7d') as StringValue)),
            path: '/',
        } as CookieOptions,
    },
}
