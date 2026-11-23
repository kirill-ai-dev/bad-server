import { Router } from 'express'
import {
    getCurrentUser,
    getCurrentUserRoles,
    login,
    logout,
    refreshAccessToken,
    register,
    updateCurrentUser,
} from '../controllers/auth'
import auth from '../middlewares/auth'
import { csrfToken } from '../middlewares/csrf'
import {
    validateAuthentication,
    validateUserBody,
    validateUserUpdate,
} from '../middlewares/validations'

const authRouter = Router()

authRouter.get('/user', auth, getCurrentUser)
authRouter.get('/csrf-token', csrfToken)
authRouter.patch('/me', auth, validateUserUpdate, updateCurrentUser)
authRouter.get('/user/roles', auth, getCurrentUserRoles)
authRouter.post('/login', validateAuthentication, login)
authRouter.post('/token', refreshAccessToken)
authRouter.post('/logout', logout)
authRouter.post('/register', validateUserBody, register)

export default authRouter
