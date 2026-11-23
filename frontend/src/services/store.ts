import { clearLegacyOrderDraft } from '../utils/session'
import { configureStore, Middleware } from '@reduxjs/toolkit'
import {
    FLUSH,
    PAUSE,
    PERSIST,
    PURGE,
    REGISTER,
    REHYDRATE,
} from 'redux-persist'

import persistStore from 'redux-persist/es/persistStore'
import weblarekApi from '../utils/weblarek-api'
import { rootReducer, isSessionBoundary } from './rootReducer'
clearLegacyOrderDraft()
const sessionMiddleware: Middleware = () => next => action => {
    if (typeof action === 'object' && action !== null && 'type' in action &&
        typeof action.type === 'string' && isSessionBoundary(action.type)) {
        weblarekApi.clearSession()
    }
    return next(action)
}
const store = configureStore({
    reducer: rootReducer,
    devTools: import.meta.env.MODE !== 'production',
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            thunk: {
                extraArgument: weblarekApi,
            },
            serializableCheck: {
                ignoredActions: [
                    FLUSH,
                    REHYDRATE,
                    PAUSE,
                    PERSIST,
                    PURGE,
                    REGISTER,
                ],
            },
        }).prepend(sessionMiddleware),
})

weblarekApi.setSessionIdentityReset(() => {
    store.dispatch({ type: 'user/resetUser' })
})

export type RootState = ReturnType<typeof rootReducer>

export type AppDispatch = typeof store.dispatch

export const persistor = persistStore(store)

export default store
