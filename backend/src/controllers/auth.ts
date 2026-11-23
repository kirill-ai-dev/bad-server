import crypto from 'crypto'
import { NextFunction, Request, Response } from 'express'
import { constants } from 'http2'
import jwt, { JwtPayload } from 'jsonwebtoken'
import { Error as MongooseError } from 'mongoose'
import { REFRESH_TOKEN } from '../config'
import BadRequestError from '../errors/bad-request-error'
import ConflictError from '../errors/conflict-error'
import NotFoundError from '../errors/not-found-error'
import UnauthorizedError from '../errors/unauthorized-error'
import User from '../models/user'
import { sessionVersionFilter } from '../utils/sessionVersion'

// POST /auth/login
const login = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email, password } = req.body
        const user = await User.findUserByCredentials(email, password)
        const accessToken = user.generateAccessToken()
        const refreshToken = await user.generateRefreshToken()
        res.cookie(
            REFRESH_TOKEN.cookie.name,
            refreshToken,
            REFRESH_TOKEN.cookie.options
        )
        return res.json({
            success: true,
            user,
            accessToken,
        })
    } catch (err) {
        return next(err)
    }
}

// POST /auth/register
const register = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email, password, name } = req.body
        const newUser = new User({ email, password, name })
        await newUser.save()
        const accessToken = newUser.generateAccessToken()
        const refreshToken = await newUser.generateRefreshToken()

        res.cookie(
            REFRESH_TOKEN.cookie.name,
            refreshToken,
            REFRESH_TOKEN.cookie.options
        )
        return res.status(constants.HTTP_STATUS_CREATED).json({
            success: true,
            user: newUser,
            accessToken,
        })
    } catch (error) {
        if (error instanceof MongooseError.ValidationError) {
            return next(new BadRequestError(error.message))
        }
        if (error instanceof Error && error.message.includes('E11000')) {
            return next(
                new ConflictError('Пользователь с таким email уже существует')
            )
        }
        return next(error)
    }
}

// GET /auth/user
const getCurrentUser = async (
    _req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const userId = res.locals.user._id
        const user = await User.findById(userId)
            .select('-orders -tokens')
            .orFail(
                () =>
                    new NotFoundError(
                        'Пользователь по заданному id отсутствует в базе'
                    )
            )
        res.json({ user, success: true })
    } catch (error) {
        next(error)
    }
}

// Можно лучше: вынести общую логику получения данных из refresh токена
const deleteRefreshTokenInUser = async (
    req: Request,
    _res: Response,
    _next: NextFunction
) => {
    const { cookies } = req
    const rfTkn = cookies[REFRESH_TOKEN.cookie.name]

    if (!rfTkn) {
        throw new UnauthorizedError('Не валидный токен')
    }

    let decodedRefreshTkn: JwtPayload
    try {
        decodedRefreshTkn = jwt.verify(rfTkn, REFRESH_TOKEN.secret, {
            algorithms: ['HS256'],
        }) as JwtPayload
    } catch (_error) {
        throw new UnauthorizedError('Не валидный токен')
    }
    if (
        !Number.isSafeInteger(decodedRefreshTkn.version) ||
        decodedRefreshTkn.version < 0
    )
        throw new UnauthorizedError('Не валидный токен')
    const rTknHash = crypto
        .createHmac('sha256', REFRESH_TOKEN.secret)
        .update(rfTkn)
        .digest('hex')
    const user = await User.findOneAndUpdate(
        {
            _id: decodedRefreshTkn.sub,
            'tokens.token': rTknHash,
            ...sessionVersionFilter(decodedRefreshTkn.version),
        },
        { $pull: { tokens: { token: rTknHash } } },
        { new: true, projection: { orders: 0, tokens: 0 } }
    ).orFail(() => new UnauthorizedError('Не валидный токен'))

    return user
}

// Реализация удаления токена из базы может отличаться
// GET  /auth/logout
const logout = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const token = req.cookies[REFRESH_TOKEN.cookie.name]
        let payload: JwtPayload
        try {
            payload = jwt.verify(token, REFRESH_TOKEN.secret, {
                algorithms: ['HS256'],
            }) as JwtPayload
            if (!Number.isSafeInteger(payload.version) || payload.version < 0)
                throw new Error('Invalid version')
        } catch (_error) {
            throw new UnauthorizedError('Не валидный токен')
        }
        // Revocation is independent of the consumed hash, closing refresh/logout races.
        // An older epoch is an idempotent logout and cannot revoke a later login.
        await User.updateOne(
            { _id: payload.sub, ...sessionVersionFilter(payload.version) },
            {
                $inc: { sessionVersion: 1 },
                $set: { tokens: [] },
            }
        )
        const expireCookieOptions = {
            ...REFRESH_TOKEN.cookie.options,
            maxAge: -1,
        }
        res.cookie(REFRESH_TOKEN.cookie.name, '', expireCookieOptions)
        res.status(200).json({
            success: true,
        })
    } catch (error) {
        next(error)
    }
}

// GET  /auth/token
const refreshAccessToken = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const userWithRefreshTkn = await deleteRefreshTokenInUser(
            req,
            res,
            next
        )
        const accessToken = await userWithRefreshTkn.generateAccessToken()
        const refreshToken = await userWithRefreshTkn.generateRefreshToken()
        res.cookie(
            REFRESH_TOKEN.cookie.name,
            refreshToken,
            REFRESH_TOKEN.cookie.options
        )
        return res.json({
            success: true,
            user: userWithRefreshTkn,
            accessToken,
        })
    } catch (error) {
        return next(error)
    }
}

const getCurrentUserRoles = (_req: Request, res: Response) => {
    res.status(200).json(res.locals.user.roles)
}

const updateCurrentUser = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const userId = res.locals.user._id
    try {
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: req.body },
            {
                new: true,
                runValidators: true,
                projection: { orders: 0, tokens: 0 },
            }
        ).orFail(
            () =>
                new NotFoundError(
                    'Пользователь по заданному id отсутствует в базе'
                )
        )
        res.status(200).json(updatedUser)
    } catch (error) {
        next(error)
    }
}

export {
    getCurrentUser,
    getCurrentUserRoles,
    login,
    logout,
    refreshAccessToken,
    register,
    updateCurrentUser,
}
