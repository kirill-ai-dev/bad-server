import { combineReducers, UnknownAction } from '@reduxjs/toolkit'
import { customersSlice } from '@slices/customers/customers-slice'
import { orderFormSlice } from '@slices/orderForm/order-form-slice'
import { ordersSlice } from '@slices/orders/orders-slice'
import { productsSlice } from '@slices/products/products-slice'
import { profileOrdersSlice } from '@slices/profile-orders/profile-orders-slice'
import { userSlice } from '@slices/user/user-slice'
import persistReducer from 'redux-persist/es/persistReducer'
import storage from 'redux-persist/lib/storage'
import basketSlice from './slice/basket'

const persistConfigBasket = {
    key: 'basket',
    storage: storage,
}
const persistedBasketReducer = persistReducer(
    persistConfigBasket,
    basketSlice.reducer
)

const combinedReducer = combineReducers({
    [basketSlice.name]: persistedBasketReducer,
    [productsSlice.name]: productsSlice.reducer,
    [orderFormSlice.name]: orderFormSlice.reducer,
    [userSlice.name]: userSlice.reducer,
    [ordersSlice.name]: ordersSlice.reducer,
    [customersSlice.name]: customersSlice.reducer,
    [profileOrdersSlice.name]: profileOrdersSlice.reducer,
})


type State = ReturnType<typeof combinedReducer>
// Request IDs belong to one immutable state/session. Late responses cannot revive a previous account.
const requests = new WeakMap<State, Set<string>>()
export const isSessionBoundary = (type: string) => [
    'user/resetUser', 'user/loginUser/pending', 'user/registerUser/pending', 'user/logoutUser/pending',
].includes(type)
export function rootReducer(state: State | undefined, action: UnknownAction): State {
    let active = state ? requests.get(state) || new Set<string>() : new Set<string>()
    const meta = action.meta as { requestId?: string; requestStatus?: string } | undefined
    if (state && meta?.requestId && ['fulfilled', 'rejected'].includes(meta.requestStatus || '') && !active.has(meta.requestId)) return state
    const identity = action.payload as { user?: { id?: string } } | undefined
    const changedIdentity = action.type === 'user/checkUserAuth/fulfilled' &&
        Boolean(state?.user.data?.id && identity?.user?.id && state.user.data.id !== identity.user.id)
    if (isSessionBoundary(action.type) || changedIdentity) {
        if (state) {
            const clean = combinedReducer(undefined, { type: 'session/initialize' })
            state = { ...clean, basket: state.basket, products: state.products,
                user: { ...clean.user, isAuthChecked: state.user.isAuthChecked } }
        }
        active = new Set()
        const currentRequest = action.meta as { requestId?: string } | undefined
        if (changedIdentity && currentRequest?.requestId) active.add(currentRequest.requestId)
    }
    if (meta?.requestId) {
        if (meta.requestStatus === 'pending') active = new Set(active).add(meta.requestId)
        else if (meta.requestStatus === 'fulfilled' || meta.requestStatus === 'rejected') {
            if (state && !active.has(meta.requestId)) return state
            active = new Set(active)
            active.delete(meta.requestId)
        }
    }
    const next = combinedReducer(state, action)
    requests.set(next, active)
    return next
}
