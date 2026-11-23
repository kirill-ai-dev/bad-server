const { test, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const { randomBytes } = require('node:crypto')
process.env.AUTH_ACCESS_TOKEN_SECRET = randomBytes(32).toString('hex')
process.env.AUTH_REFRESH_TOKEN_SECRET = randomBytes(32).toString('hex')
const { default: app, rateLimitStore } = require('../src/app')
beforeEach(async () => {
    rateLimitStore.resetAll()
    if (customer) {
        customer = await User.findById(customer._id)
        admin = await User.findById(admin._id)
        customerToken = customer.generateAccessToken()
        adminToken = admin.generateAccessToken()
    }
})
const User = require('../src/models/user').default
let mongo, customer, admin, customerToken, adminToken
const password = randomBytes(16).toString('hex')
async function csrf(agent) {
    const res = await agent.get('/auth/csrf-token')
    assert.equal(res.status, 200)
    return res.body.csrfToken
}
async function login(email) {
    const agent = request.agent(app)
    const token = await csrf(agent)
    const res = await agent.post('/auth/login').set('X-CSRF-Token', token).send({ email, password })
    assert.equal(res.status, 200)
    return { agent, token, access: res.body.accessToken }
}
before(async () => {
    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 30000 } })
    await mongoose.connect(mongo.getUri())
    customer = await User.create({ email: 'customer@test.ru', password, name: 'Customer' })
    admin = await User.create({ email: 'admin@test.ru', password, name: 'Admin', roles: ['admin'] })
    customerToken = customer.generateAccessToken()
    adminToken = admin.generateAccessToken()
})
after(async () => { await mongoose.disconnect(); await mongo?.stop() })
test('unauthenticated protected requests return 401 without crashing', async () => {
    assert.equal((await request(app).get('/auth/user')).status, 401)
    assert.equal((await request(app).get('/product')).status, 200)
})
test('passwords use bcrypt and never appear in responses', async () => {
    const stored = await User.findById(customer._id).select('+password')
    assert.match(stored.password, /^\$2[aby]\$/)
    const session = await login(customer.email)
    const res = await session.agent.get('/auth/user').set('Authorization', `Bearer ${session.access}`)
    assert.equal(res.body.user.password, undefined)
    assert.equal(res.body.user.tokens, undefined)
})
test('all state changes require a valid CSRF token', async () => {
    assert.equal((await request(app).post('/auth/register').send({})).status, 403)
    const agent = request.agent(app)
    await csrf(agent)
    assert.equal((await agent.patch('/auth/me').set('Authorization', `Bearer ${customerToken}`).set('X-CSRF-Token', 'forged').send({ name: 'Other' })).status, 403)
})
test('NoSQL login injection and oversized passwords are rejected', async () => {
    const agent = request.agent(app), token = await csrf(agent)
    for (const body of [{ email: { $ne: null }, password }, { email: customer.email, password: 'a'.repeat(1000) }]) {
        assert.equal((await agent.post('/auth/login').set('X-CSRF-Token', token).send(body)).status, 400)
    }
})
test('customer cannot read admin resources or assign roles', async () => {
    for (const url of ['/customers', `/customers/${admin._id}`, '/order/all']) {
        assert.equal((await request(app).get(url).set('Authorization', `Bearer ${customerToken}`)).status, 403)
    }
    const { agent, token, access } = await login(customer.email)
    assert.equal((await agent.patch('/auth/me').set('Authorization', `Bearer ${access}`).set('X-CSRF-Token', token).send({ roles: ['admin'] })).status, 400)
    assert.deepEqual((await User.findById(customer._id)).roles, ['customer'])
})
async function refreshSession(email) {
    const agent = request.agent(app)
    const csrfResponse = await agent.get('/auth/csrf-token')
    const token = csrfResponse.body.csrfToken
    const response = await agent.post('/auth/login').set('X-CSRF-Token', token).send({ email, password })
    assert.equal(response.status, 200)
    const cookies = [...csrfResponse.headers['set-cookie'], ...response.headers['set-cookie']].map(value => value.split(';')[0])
    return { agent, token, cookies }
}
test('consumed refresh token cannot be replayed before logout', async () => {
    const { agent, token, cookies } = await refreshSession(customer.email)
    const refresh = await agent.post('/auth/token').set('X-CSRF-Token', token)
    assert.equal(refresh.status, 200)
    assert.equal((await request(app).post('/auth/token').set('Cookie', cookies).set('X-CSRF-Token', token)).status, 401)
    assert.equal((await agent.post('/auth/logout').set('X-CSRF-Token', token)).status, 200)
    const refreshedCookies = [...cookies.filter(value => !value.startsWith('refreshToken=')), refresh.headers['set-cookie'].find(value => value.startsWith('refreshToken=')).split(';')[0]]
    assert.equal((await request(app).post('/auth/token').set('Cookie', refreshedCookies).set('X-CSRF-Token', token)).status, 401)
})
test('parallel refresh attempts consume a token exactly once', async () => {
    const { token, cookies } = await refreshSession(customer.email)
    const results = await Promise.all([1, 2].map(() => request(app).post('/auth/token').set('Cookie', cookies).set('X-CSRF-Token', token)))
    assert.deepEqual(results.map(response => response.status).sort(), [200, 401])
})
test('logout revokes rotated and pending tokens without revoking a later login', async () => {
    const { agent, token, cookies } = await refreshSession(customer.email)
    const rotated = await agent.post('/auth/token').set('X-CSRF-Token', token)
    assert.equal(rotated.status, 200)
    const rotatedCookies = [...cookies.filter(value => !value.startsWith('refreshToken=')), rotated.headers['set-cookie'].find(value => value.startsWith('refreshToken=')).split(';')[0]]
    // Old signed cookie may be held by an in-flight logout while refresh finishes.
    assert.equal((await request(app).post('/auth/logout').set('Cookie', cookies).set('X-CSRF-Token', token)).status, 200)
    assert.equal((await request(app).post('/auth/token').set('Cookie', rotatedCookies).set('X-CSRF-Token', token)).status, 401)
    assert.equal((await request(app).get('/auth/user').set('Authorization', `Bearer ${rotated.body.accessToken}`)).status, 401)
    const later = await refreshSession(customer.email)
    assert.equal((await request(app).post('/auth/logout').set('Cookie', cookies).set('X-CSRF-Token', token)).status, 200)
    assert.equal((await later.agent.post('/auth/token').set('X-CSRF-Token', later.token)).status, 200)
    const staleUser = await User.findById(customer._id)
    await later.agent.post('/auth/logout').set('X-CSRF-Token', later.token)
    await assert.rejects(staleUser.generateRefreshToken())
})
test('query operators, unbounded pagination and invalid ids are rejected', async () => {
    for (const url of ['/order/all?status[$ne]=new', '/customers?search[$regex]=.*', '/customers/not-an-id']) {
        assert.equal((await request(app).get(url).set('Authorization', `Bearer ${adminToken}`)).status, 400)
    }
})
test('request bodies have a bounded size', async () => {
    const agent = request.agent(app), token = await csrf(agent)
    assert.equal((await agent.post('/auth/register').set('X-CSRF-Token', token).send({ name: 'x'.repeat(200000) })).status, 413)
})
test('static serving denies files outside public and dotfiles', async () => {
    for (const url of ['/..%2f..%2fpackage.json', '/%2e%2e%2fconfig.ts', '/.env']) {
        assert.ok([400, 403, 404].includes((await request(app).get(url)).status))
    }
})
test('roles endpoint and normalized pagination work for admin', async () => {
    const roles = await request(app).get('/auth/user/roles').set('Authorization', `Bearer ${adminToken}`)
    assert.equal(roles.status, 200)
    assert.deepEqual(roles.body, ['admin'])
    for (const url of ['/customers?limit=1000', '/order/all?limit=1000', '/customers?search=1%2B%7B%7D%24()']) {
        const res = await request(app).get(url).set('Authorization', `Bearer ${adminToken}`)
        assert.equal(res.status, 200)
        assert.ok(res.body.pagination.pageSize <= 10)
    }
})
test('stale documents cannot restore revoked refresh tokens', async () => {
    await User.updateOne({ _id: admin._id }, { $set: { tokens: [{ token: 'revoked' }] } })
    const stale = await User.findById(admin._id)
    await User.updateOne({ _id: admin._id }, { $pull: { tokens: { token: 'revoked' } } })
    await stale.generateRefreshToken()
    assert.ok(!(await User.findById(admin._id)).tokens.some(t => t.token === 'revoked'))
})
test('rich comments preserve formatting and remove scripts and unsafe links', () => {
    const { sanitizeComment } = require('../src/utils/sanitize')
    assert.equal(sanitizeComment('<b>Hello</b><img src=x onerror=alert(1)><script>alert(1)</script><a href="javascript:alert(1)">link</a>'), '<b>Hello</b><a>link</a>')
    const { phoneRegExp } = require('../src/middlewares/validations')
    assert.equal(phoneRegExp.test('1'.repeat(100000) + 'a'), false)
})
test('order stores only a sanitized comment and enforces ownership', async () => {
    const Product = require('../src/models/product').default
    const product = await Product.create({ title: 'Test Product', image: { fileName: '/images/test.svg', originalName: 'test.svg' }, category: 'other', price: 100 })
    const { agent, token, access } = await login(customer.email)
    const result = await agent.post('/order').set('Authorization', `Bearer ${access}`).set('X-CSRF-Token', token).send({ items: [product.id], total: 100, email: customer.email, phone: '+71234567890', address: 'Test address', payment: 'online', comment: '<p>Hi</p><img src=x onerror=alert(1)>' })
    assert.equal(result.status, 200)
    assert.equal(result.body.comment, '<p>Hi</p>')
    assert.equal((await request(app).get(`/order/me/${result.body.orderNumber}`).set('Authorization', `Bearer ${adminToken}`)).status, 404)
})
test('uploads validate content, sizes and permissions', async () => {
    const sharp = require('sharp')
    const { agent, token, access } = await login(admin.email)
    const upload = data => agent.post('/upload').set('Authorization', `Bearer ${access}`).set('X-CSRF-Token', token).attach('file', data, { filename: 'original.png', contentType: 'image/png' })
    assert.equal((await upload(Buffer.alloc(2048))).status, 400)
    assert.equal((await upload(Buffer.alloc(4096))).status, 400)
    assert.equal((await upload(Buffer.alloc(6 * 1024 * 1024))).status, 413)
    const data = await sharp(require('node:crypto').randomBytes(100 * 100 * 3), { raw: { width: 100, height: 100, channels: 3 } }).png().toBuffer()
    const res = await upload(data)
    assert.equal(res.status, 201)
    assert.notEqual(res.body.fileName, '/images/original.png')
    const fs = require('node:fs/promises'), path = require('node:path')
    await fs.unlink(path.join(__dirname, '../src/public/temp', path.basename(res.body.fileName)))
})
test('load is bounded by rate limiting and process stays responsive', async () => {
    const results = await Promise.all(Array.from({ length: 100 }, () => request(app).get('/product')))
    assert.ok(results.some(r => r.status === 429))
    assert.ok(results.every(r => [200, 429].includes(r.status)))
    assert.equal((await request(app).get('/product')).status, 429)
})
