import { API_URL, CDN_URL } from '@constants'

import {
    ICustomerPaginationResult,
    ICustomerResult,
    IFile,
    IOrder,
    IOrderPaginationResult,
    IOrderResult,
    IProduct,
    IProductPaginationResult,
    ServerResponse,
    StatusType,
    UserLoginBodyDto,
    UserRegisterBodyDto,
    UserResponse,
    UserResponseToken,
} from '@types'
import { clearLegacyAuthCookie, isSignedOut, markSignedOut } from './session'

export const enum RequestStatus {
    Idle = 'idle',
    Loading = 'loading',
    Success = 'success',
    Failed = 'failed',
}

export type ApiListResponse<Type> = {
    total: number
    items: Type[]
}

class Api {
    private readonly baseUrl: string
    private csrfPromise?: Promise<string>
    private refreshPromise?: Promise<UserResponseToken>
    protected accessToken = ''
    protected generation = 0
    private controller = new AbortController()
    protected canRefresh = !isSignedOut()
    private currentUserId?: string
    private onSessionIdentityReset?: () => void
    protected options: RequestInit

    setSessionIdentityReset = (callback: () => void) => {
        this.onSessionIdentityReset = callback
    }

    protected acceptUserIdentity(userId: string | undefined, generation: number) {
        if (!userId) return
        this.assertSession(generation)
        if (this.currentUserId && this.currentUserId !== userId) {
            this.onSessionIdentityReset?.()
            this.clearSession()
            throw new DOMException('Account changed', 'AbortError')
        }
        this.currentUserId = userId
    }

    clearSession = () => {
        this.generation += 1
        this.controller.abort()
        this.controller = new AbortController()
        this.accessToken = ''
        this.currentUserId = undefined
        this.csrfPromise = undefined
        this.refreshPromise = undefined
        this.canRefresh = false
        markSignedOut(true)
        clearLegacyAuthCookie()
    }

    protected assertSession(generation: number) {
        if (generation !== this.generation) throw new DOMException('Session changed', 'AbortError')
    }

    constructor(baseUrl: string, options: RequestInit = {}) {
        clearLegacyAuthCookie()
        this.baseUrl = baseUrl
        this.options = {
            headers: {
                ...((options.headers as object) ?? {}),
            },
        }
    }

    protected handleResponse<T>(response: Response): Promise<T> {
        return response.ok
            ? response.json()
            : response
                  .json()
                  .then((err) =>
                      Promise.reject({ ...err, statusCode: response.status })
                  )
    }

    protected async request<T>(endpoint: string, options: RequestInit) {
        const generation = this.generation
        const signal = this.controller.signal
        try {
            const headers = new Headers(options.headers)
            if (!['GET', 'HEAD', 'OPTIONS'].includes(options.method || 'GET')) {
                this.csrfPromise ??= fetch(`${this.baseUrl}/auth/csrf-token`, { credentials: 'include', signal })
                    .then(res => this.handleResponse<{ csrfToken: string }>(res))
                    .then(data => data.csrfToken)
                    .finally(() => { if (generation === this.generation) this.csrfPromise = undefined })
                headers.set('X-CSRF-Token', await this.csrfPromise)
                this.assertSession(generation)
            }
            const res = await fetch(`${this.baseUrl}${endpoint}`, {
                ...this.options,
                ...options,
                headers,
                credentials: 'include',
                signal,
            })
            const data = await this.handleResponse<T>(res)
            this.assertSession(generation)
            return data
        } catch (error) {
            this.assertSession(generation)
            return Promise.reject(error)
        }
    }

    private refreshToken = () => {
        return this.request<UserResponseToken>('/auth/token', {
            method: 'POST',
            credentials: 'include',
        })
    }

    protected requestWithRefresh = async <T>(
        endpoint: string,
        options: RequestInit
    ) => {
        const generation = this.generation
        try {
            return await this.request<T>(endpoint, options)
        } catch (error) {
            this.assertSession(generation)
            if (!this.canRefresh || (error as { statusCode?: number }).statusCode !== 401)
                throw error
            this.refreshPromise ??= this.refreshToken().finally(() => { if (generation === this.generation) this.refreshPromise = undefined })
            const refreshData = await this.refreshPromise
            if (!refreshData.success) {
                return Promise.reject(refreshData)
            }
            this.acceptUserIdentity(refreshData.user?.id, generation)
            this.accessToken = refreshData.accessToken
            return await this.request<T>(endpoint, {
                ...options,
                headers: {
                    ...options.headers,
                    Authorization: `Bearer ${this.accessToken}`,
                },
            })
        }
    }
}

export interface IWebLarekAPI {
    getProductList: (
        filters: Record<string, unknown>
    ) => Promise<IProductPaginationResult>
    getProductItem: (id: string) => Promise<IProduct>
    createOrder: (order: IOrder) => Promise<IOrderResult>
}

export class WebLarekAPI extends Api implements IWebLarekAPI {
    readonly cdn: string

    constructor(cdn: string, baseUrl: string, options?: RequestInit) {
        super(baseUrl, options)
        this.cdn = cdn
    }

    getProductItem = (id: string): Promise<IProduct> => {
        return this.request<IProduct>(`/product/${id}`, { method: 'GET' }).then(
            (data: IProduct) => ({
                ...data,
                image: {
                    ...data.image,
                    fileName: this.cdn + data.image.fileName,
                },
            })
        )
    }

    getProductList = (
        filters: Record<string, unknown> = {}
    ): Promise<IProductPaginationResult> => {
        const queryParams = new URLSearchParams(
            filters as Record<string, string>
        ).toString()
        return this.request<IProductPaginationResult>(
            `/product?${queryParams}`,
            {
                method: 'GET',
            }
        ).then((data) => ({
            ...data,
            items: data.items.map((item) => ({
                ...item,
                image: {
                    ...item.image,
                    fileName: this.cdn + item.image.fileName,
                },
            })),
        }))
    }

    createOrder = (order: IOrder): Promise<IOrderResult> => {
        return this.requestWithRefresh<IOrderResult>('/order', {
            method: 'POST',
            body: JSON.stringify(order),
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.accessToken}`,
            },
        }).then((data: IOrderResult) => data)
    }

    updateOrderStatus = (
        status: StatusType,
        orderNumber: string
    ): Promise<IOrderResult> => {
        return this.requestWithRefresh<IOrderResult>(`/order/${orderNumber}`, {
            method: 'PATCH',
            body: JSON.stringify({ status }),
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.accessToken}`,
            },
        })
    }

    getAllOrders = (
        filters: Record<string, unknown> = {}
    ): Promise<IOrderPaginationResult> => {
        const queryParams = new URLSearchParams(
            filters as Record<string, string>
        ).toString()
        return this.requestWithRefresh<IOrderPaginationResult>(
            `/order/all?${queryParams}`,
            {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                },
            }
        )
    }

    getCurrentUserOrders = (
        filters: Record<string, unknown> = {}
    ): Promise<IOrderPaginationResult> => {
        const queryParams = new URLSearchParams(
            filters as Record<string, string>
        ).toString()
        return this.requestWithRefresh<IOrderPaginationResult>(
            `/order/all/me?${queryParams}`,
            {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                },
            }
        )
    }

    getOrderByNumber = (orderNumber: string): Promise<IOrderResult> => {
        return this.requestWithRefresh<IOrderResult>(`/order/${orderNumber}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${this.accessToken}` },
        })
    }

    getOrderCurrentUserByNumber = (
        orderNumber: string
    ): Promise<IOrderResult> => {
        return this.requestWithRefresh<IOrderResult>(
            `/order/me/${orderNumber}`,
            {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                },
            }
        )
    }

    loginUser = (data: UserLoginBodyDto) => {
        this.clearSession()
        const generation = this.generation
        return this.request<UserResponseToken>('/auth/login', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
        }).then(data => {
            this.assertSession(generation)
            this.acceptUserIdentity(data.user?.id, generation)
            this.accessToken = data.accessToken
            this.canRefresh = true
            markSignedOut(false)
            return data
        })
    }

    registerUser = (data: UserRegisterBodyDto) => {
        this.clearSession()
        const generation = this.generation
        return this.request<UserResponseToken>('/auth/register', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
        }).then(data => {
            this.assertSession(generation)
            this.acceptUserIdentity(data.user?.id, generation)
            this.accessToken = data.accessToken
            this.canRefresh = true
            markSignedOut(false)
            return data
        })
    }

    getUser = async () => {
        const generation = this.generation
        const response = await this.requestWithRefresh<UserResponse>('/auth/user', {
            method: 'GET',
            headers: { Authorization: `Bearer ${this.accessToken}` },
        })
        this.acceptUserIdentity(response.user?.id, generation)
        return response
    }

    getUserRoles = () => {
        return this.requestWithRefresh<string[]>('/auth/user/roles', {
            method: 'GET',
            headers: { Authorization: `Bearer ${this.accessToken}` },
        })
    }

    getAllCustomers = (
        filters: Record<string, unknown> = {}
    ): Promise<ICustomerPaginationResult> => {
        const queryParams = new URLSearchParams(
            filters as Record<string, string>
        ).toString()
        return this.requestWithRefresh<ICustomerPaginationResult>(
            `/customers?${queryParams}`,
            {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                },
            }
        )
    }

    getCustomerById = (idCustomer: string) => {
        return this.requestWithRefresh<ICustomerResult>(
            `/customers/${idCustomer}`,
            {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                },
            }
        )
    }

    logoutUser = () => {
        this.clearSession()
        return this.request<ServerResponse<unknown>>('/auth/logout', {
            method: 'POST',
            credentials: 'include',
        })
    }

    createProduct = (data: Omit<IProduct, '_id'>) => {
        return this.requestWithRefresh<IProduct>('/product', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.accessToken}`,
            },
        }).then((data: IProduct) => ({
            ...data,
            image: {
                ...data.image,
                fileName: this.cdn + data.image.fileName,
            },
        }))
    }

    uploadFile = (data: FormData) => {
        return this.requestWithRefresh<IFile>('/upload', {
            method: 'POST',
            body: data,
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
            },
        }).then((data) => ({
            ...data,
            fileName: data.fileName,
        }))
    }

    updateProduct = (data: Partial<Omit<IProduct, '_id'>>, id: string) => {
        return this.requestWithRefresh<IProduct>(`/product/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.accessToken}`,
            },
        }).then((data: IProduct) => ({
            ...data,
            image: {
                ...data.image,
                fileName: this.cdn + data.image.fileName,
            },
        }))
    }

    deleteProduct = (id: string) => {
        return this.requestWithRefresh<IProduct>(`/product/${id}`, {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
            },
        })
    }
}

export default new WebLarekAPI(CDN_URL, API_URL)
