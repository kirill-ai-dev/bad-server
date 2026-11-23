import { beforeEach, expect, test, vi } from 'vitest'
import { rootReducer } from '../src/services/rootReducer'
import { userSlice } from '../src/services/slice/user/user-slice'
import { WebLarekAPI } from '../src/utils/weblarek-api'
const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data), { status: 200 }))
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); document.cookie = 'accessToken=; Max-Age=0; path=/' })
test('account boundary clears private data and draft, preserves basket', () => {
 let state = rootReducer(undefined, { type: 'init' })
 state = { ...state, orders: { ...state.orders, ordersData: [{ orderNumber: 1 }] }, 'order-form': { ...state['order-form'], info: { address: 'private-address' } } } as typeof state
 const basket = state.basket
 state = rootReducer(state, userSlice.actions.resetUser())
 expect(state.orders.ordersData).toEqual([])
 expect(state['order-form'].info.address).toBe('')
 expect(state.basket).toEqual(basket)
})
test('old session fulfillment is rejected after boundary', () => {
 let state = rootReducer(undefined, { type: 'profile-orders/getCurrentUserOrders/pending', meta: { requestId: 'old', requestStatus: 'pending' } })
 state = rootReducer(state, userSlice.actions.resetUser())
 const prior = state
 state = rootReducer(state, { type: 'profile-orders/getCurrentUserOrders/fulfilled', payload: { orders: [{ orderNumber: 1 }] }, meta: { requestId: 'old', requestStatus: 'fulfilled' } })
 expect(state).toBe(prior)
})
test('token is held in memory and legacy token cookie removed', async () => {
 document.cookie = 'accessToken=legacy; path=/'
 const api = new WebLarekAPI('/cdn', '/api')
 const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
   if (String(url).includes('csrf-token')) return new Response(JSON.stringify({csrfToken:'csrf'}))
   if (String(url).includes('/login')) return new Response(JSON.stringify({success:true,user:{id:'a'},accessToken:'memory-token'}))
   expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer memory-token')
   return new Response(JSON.stringify({success:true,user:{id:'a'}}))
 })
 await api.loginUser({email:'a@test.ru',password:'test-password'})
 await api.getUser()
 expect(document.cookie).not.toContain('accessToken')
 expect(localStorage.length).toBe(0)
 expect(fetchMock).toHaveBeenCalled()
})
test('late refresh cannot restore auth after logout failure', async () => {
 const api = new WebLarekAPI('/cdn', '/api')
 let resolveRefresh!: (value: Response) => void
 const started = Promise.withResolvers<void>()
 vi.spyOn(globalThis,'fetch').mockImplementation((url) => {
   if(String(url).includes('csrf-token')) return ok({csrfToken:'csrf'})
   if(String(url).includes('/auth/user')) return Promise.resolve(new Response('{}',{status:401}))
   if(String(url).includes('/auth/token')) { started.resolve(); return new Promise(resolve => {resolveRefresh=resolve}) }
   return Promise.reject(new Error('offline'))
 })
 const reading = api.getUser().catch(error=>error)
 await started.promise
 await api.logoutUser().catch(()=>undefined)
 resolveRefresh(new Response(JSON.stringify({success:true,accessToken:'stale',user:{id:'old'}})))
 expect(await reading).toMatchObject({name:'AbortError'})
 await expect(api.getUser()).rejects.toMatchObject({statusCode:401})
})
test('normal async result accepted, but same result after logout is ignored', () => {
 const pending = {type:'user/checkUserRoles/pending',meta:{requestId:'roles',requestStatus:'pending'}}
 const fulfilled = {type:'user/checkUserRoles/fulfilled',payload:['admin'],meta:{requestId:'roles',requestStatus:'fulfilled'}}
 let state=rootReducer(undefined,pending)
 expect(rootReducer(state,fulfilled).user.roles).toEqual(['admin'])
 state=rootReducer(state,userSlice.actions.resetUser())
 expect(rootReducer(state,fulfilled).user.roles).toEqual([])
})
test('concurrent unauthorized requests coalesce refresh and use its in-memory token', async () => {
 const api = new WebLarekAPI('/cdn', '/api')
 let refreshes=0
 vi.spyOn(globalThis,'fetch').mockImplementation((url,options) => {
  if(String(url).includes('csrf-token')) return ok({csrfToken:'csrf'})
  if(String(url).includes('/auth/token')) {refreshes++;return ok({success:true,accessToken:'new-token',user:{id:'a'}})}
  if(new Headers(options?.headers).get('Authorization')==='Bearer new-token') return ok({success:true,user:{id:'a'}})
  return Promise.resolve(new Response('{}',{status:401}))
 })
 await Promise.all([api.getUser(),api.getUserRoles()])
 expect(refreshes).toBe(1)
 expect(document.cookie).not.toContain('accessToken')
})
test('signout suppression survives API recreation without persisting tokens', async () => {
 const api=new WebLarekAPI('/cdn','/api')
 vi.spyOn(globalThis,'fetch').mockImplementation(url => String(url).includes('csrf-token')?ok({csrfToken:'csrf'}):Promise.resolve(new Response('{}',{status:401})))
 await api.logoutUser().catch(()=>undefined)
 vi.mocked(fetch).mockClear()
 await new WebLarekAPI('/cdn','/api').getUser().catch(()=>undefined)
 expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('/auth/token'))).toBe(false)
})
test('profile selector never reads admin cached orders', async () => {
 const { selectProfileOrderByNumber }=await import('../src/services/selector')
 let state=rootReducer(undefined,{type:'init'})
 state={...state,user:{...state.user,data:{id:'current',name:'Current',email:'current@test.ru'}},orders:{...state.orders,ordersData:[{orderNumber:1,customer:{id:'other'}}]}} as typeof state
 expect(selectProfileOrderByNumber(1)(state)).toBe(null)
})
test('legacy saved contact draft is removed at client creation', () => {
 localStorage.setItem('persist:order','private contacts')
 new WebLarekAPI('/cdn','/api')
 expect(localStorage.getItem('persist:order')).toBe(null)
})
test('server-reported identity change resets cached private state', () => {
 let state=rootReducer(undefined,{type:'init'})
 state={...state,user:{...state.user,data:{id:'A',name:'A',email:'a@test.ru'}},orders:{...state.orders,ordersData:[{orderNumber:1}]}} as typeof state
 state=rootReducer(state,{type:'user/checkUserAuth/pending',meta:{requestId:'identity',requestStatus:'pending'}})
 state=rootReducer(state,{type:'user/checkUserAuth/fulfilled',payload:{user:{id:'B',name:'B',email:'b@test.ru'}},meta:{requestId:'identity',requestStatus:'fulfilled'}})
 expect(state.orders.ordersData).toEqual([])
 expect(state.user.data?.id).toBe('B')
})
test('old auth response cannot override the next account identity', () => {
 let state=rootReducer(undefined,{type:'user/checkUserAuth/pending',meta:{requestId:'old-auth',requestStatus:'pending'}})
 state=rootReducer(state,userSlice.actions.resetUser())
 state=rootReducer(state,{type:'user/loginUser/pending',meta:{requestId:'new-login',requestStatus:'pending'}})
 state=rootReducer(state,{type:'user/loginUser/fulfilled',payload:{user:{id:'B',name:'B',email:'b@test.ru'}},meta:{requestId:'new-login',requestStatus:'fulfilled'}})
 state=rootReducer(state,{type:'user/checkUserAuth/fulfilled',payload:{user:{id:'A',name:'A',email:'a@test.ru'}},meta:{requestId:'old-auth',requestStatus:'fulfilled'}})
 expect(state.user.data?.id).toBe('B')
})

test('refresh identity change resets the session before data is exposed', async () => {
 const api = new WebLarekAPI('/cdn','/api')
 let state=rootReducer(undefined,{type:'init'})
 state={...state,user:{...state.user,data:{id:'A',name:'A',email:'a@test.ru'}},orders:{...state.orders,ordersData:[{orderNumber:1}]}} as typeof state
 let reset = 0
 api.setSessionIdentityReset(() => { reset += 1; state=rootReducer(state,userSlice.actions.resetUser()) })
 const fetchMock=vi.spyOn(globalThis,'fetch').mockImplementation((url) => {
  if(String(url).includes('csrf-token')) return ok({csrfToken:'csrf'})
  if(String(url).includes('/auth/login')) return ok({success:true,accessToken:'token-a',user:{id:'A',name:'A',email:'a@test.ru'}})
  if(String(url).includes('/auth/token')) return ok({success:true,accessToken:'token-b',user:{id:'B',name:'B',email:'b@test.ru'}})
  return Promise.resolve(new Response('{}',{status:401}))
 })
 await api.loginUser({email:'a@test.ru',password:'password'})
 await expect(api.getUserRoles()).rejects.toMatchObject({name:'AbortError'})
 expect(reset).toBe(1)
 expect(state.user.data).toBe(null)
 expect(state.orders.ordersData).toEqual([])
 expect(fetchMock.mock.calls.some(([, options])=>new Headers(options?.headers).get('Authorization')==='Bearer token-b')).toBe(false)
 await expect(api.getUser()).rejects.toMatchObject({statusCode:401})
 expect(fetchMock.mock.calls.filter(([url])=>String(url).includes('/auth/token'))).toHaveLength(1)
})
