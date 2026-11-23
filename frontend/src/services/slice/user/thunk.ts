import {
    ServerResponse,
    UserLoginBodyDto,
    UserRegisterBodyDto,
    UserResponse,
    UserResponseToken,
} from '@types'
import { createAsyncThunk } from '../../hooks'

export const checkUserAuth = createAsyncThunk<UserResponse, void>(
    `user/checkUserAuth`,
    async (_, { extra: api }) => {
        return await api.getUser()
    }
)

export const checkUserRoles = createAsyncThunk<string[], void>(
    `user/checkUserRoles`,
    async (_, { extra: api }) => {
        return await api.getUserRoles()
    }
)

export const registerUser = createAsyncThunk<
    UserResponseToken,
    UserRegisterBodyDto
>(`user/registerUser`, async (dataUser, { extra: api }) => {
    const data = await api.registerUser(dataUser)
    return data
})

export const loginUser = createAsyncThunk<UserResponseToken, UserLoginBodyDto>(
    `user/loginUser`,
    async (dataUser, { extra: api }) => {
        const data = await api.loginUser(dataUser)
        return data
    }
)

export const logoutUser = createAsyncThunk<ServerResponse<unknown>, void>(
    `user/logoutUser`,
    async (_, { extra: api }) => {
        const data = await api.logoutUser()
        return data
    }
)
