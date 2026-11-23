import { RootState } from '../store'

export const selectOrderByNumber =
    (orderNumber: number) => (state: RootState) => {
        if (state.orders.ordersData.length) {
            const data = state.orders.ordersData.find(
                (item) => item.orderNumber === orderNumber
            )
            return data ? data : null
        }
        if (state['profile-orders'].ordersData.length) {
            const data = state['profile-orders'].ordersData.find(
                (item) => item.orderNumber === orderNumber
            )
            return data ? data : null
        }

        return null
    }

export const selectProfileOrderByNumber =
    (orderNumber: number) => (state: RootState) => {
        const userId = state.user.data?.id
        if (!userId) return null
        return state['profile-orders'].ordersData.find(order =>
            order.orderNumber === orderNumber && order.customer?.id === userId
        ) || null
    }

export const selectCustomerById =
    (customerId: string) => (state: RootState) => {
        if (state.customers.customersData.length) {
            const data = state.customers.customersData.find(
                (item) => item.id === customerId
            )
            return data ? data : null
        }
        return null
    }
