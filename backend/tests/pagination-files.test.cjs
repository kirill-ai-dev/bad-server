const { test, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { randomBytes, randomUUID } = require('node:crypto')
const { MongoMemoryServer } = require('mongodb-memory-server')
const mongoose = require('mongoose')
const request = require('supertest')
process.env.AUTH_ACCESS_TOKEN_SECRET = randomBytes(32).toString('hex')
process.env.AUTH_REFRESH_TOKEN_SECRET = randomBytes(32).toString('hex')
const { default: app, rateLimitStore } = require('../src/app')
const User = require('../src/models/user').default
const Product = require('../src/models/product').default
const Order = require('../src/models/order').default
let mongo, root, user, admin, products
before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'weblarek-files-'))
    process.env.IMAGE_STORAGE_ROOT = root
    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 30000 } })
    await mongoose.connect(mongo.getUri())
    user = await User.create({ name: 'Customer', email: 'customer@audit.ru', password: randomBytes(16).toString('hex') })
    admin = await User.create({ name: 'Admin', email: 'admin@audit.ru', password: randomBytes(16).toString('hex'), roles: ['admin'] })
    products = await Product.create([1, 2].map(n => ({ title: `Paged product ${n}`, category: 'other', price: n, image: { fileName: `/images/fixture${n}.png`, originalName: 'fixture.png' } })))
    await Order.collection.insertMany(Array.from({ length: 25 }, (_, i) => ({ orderNumber: 100 + i, customer: user._id, products: products.map(p => p._id), totalAmount: 3, status: 'new', payment: 'online', email: user.email, phone: '+71234567890', createdAt: new Date(i * 1000) })))
    await User.updateOne({ _id: user._id }, { $set: { orders: (await Order.find({})).map(o => o._id) } })
})
after(async () => { await mongoose.disconnect(); await mongo?.stop(); await fs.rm(root, { recursive: true, force: true }) })
beforeEach(() => rateLimitStore.resetAll())
test('profile pagination reads only the requested page from orders', async () => {
    const queries = []
    mongoose.set('debug', (collection, method, filter, options) => {
        if (collection === 'orders' && method === 'find') queries.push({ filter, options })
    })
    try {
        const response = await request(app).get('/order/all/me?limit=1&page=2').set('Authorization', `Bearer ${user.generateAccessToken()}`)
        assert.equal(response.status, 200)
        assert.equal(response.body.orders.length, 1)
        assert.equal(response.body.pagination.totalOrders, 25)
        assert.ok(queries.some(q => q.options.limit === 1 && q.options.skip === 1 && String(q.filter.customer) === user.id))
    } finally { mongoose.set('debug', false) }
})
test('admin pagination retains full product lists and search counts', async () => {
    const response = await request(app).get('/order/all?limit=1&search=Paged').set('Authorization', `Bearer ${admin.generateAccessToken()}`)
    assert.equal(response.status, 200)
    assert.equal(response.body.orders.length, 1)
    assert.equal(response.body.orders[0].products.length, 2)
    assert.equal(response.body.pagination.totalOrders, 25)
})
test('image cleanup removes expired managed temp files and preserves references and fixtures', async () => {
    const { cleanupImages } = require('../src/utils/imageStorage')
    await fs.mkdir(path.join(root, 'temp'), { recursive: true })
    await fs.mkdir(path.join(root, 'images'), { recursive: true })
    const stale = `${randomUUID()}.png`, referenced = `${randomUUID()}.png`
    await fs.writeFile(path.join(root, 'temp', stale), 'stale')
    await fs.utimes(path.join(root, 'temp', stale), new Date(0), new Date(0))
    await fs.writeFile(path.join(root, 'images', referenced), 'referenced')
    await fs.utimes(path.join(root, 'images', referenced), new Date(0), new Date(0))
    await fs.writeFile(path.join(root, 'images', 'fixture.png'), 'fixture')
    await Product.create({ title: 'Referenced file', category: 'other', image: { fileName: `/images/${referenced}`, originalName: 'file.png' } })
    await cleanupImages()
    await assert.rejects(fs.access(path.join(root, 'temp', stale)))
    await fs.access(path.join(root, 'images', referenced))
    await fs.access(path.join(root, 'images', 'fixture.png'))
})
test('image quota serializes writes and rejects excess total storage', async () => {
    const { storeImage, withImageStorageLock } = require('../src/utils/imageStorage')
    const sizes = await Promise.all(['temp','images'].map(async dir => (await Promise.all((await fs.readdir(path.join(root, dir))).map(async name => (await fs.stat(path.join(root, dir, name))).size))).reduce((a,b) => a+b,0)))
    process.env.IMAGE_STORAGE_MAX_BYTES = String(sizes.reduce((a,b)=>a+b,0) + 100)
    try {
        const results = await Promise.allSettled([1,2].map(() => withImageStorageLock(() => storeImage(Buffer.alloc(60)))))
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
        assert.equal(results.filter(r => r.status === 'rejected').length, 1)
    } finally { delete process.env.IMAGE_STORAGE_MAX_BYTES }
})
test('product DB failure restores staged image; referenced old file is never deleted', async () => {
    const { withImageStorageLock, stageImage } = require('../src/utils/imageStorage')
    const filename = `${randomUUID()}.png`
    await fs.writeFile(path.join(root, 'temp', filename), 'image')
    await withImageStorageLock(async () => {
        const stage = await stageImage(`/images/${filename}`)
        await fs.access(path.join(root, 'images', filename))
        await stage.rollback()
    })
    await fs.access(path.join(root, 'temp', filename))
    await assert.rejects(fs.access(path.join(root, 'images', filename)))
})

test('API restores upload on duplicate title and safely deletes only unreferenced managed files', async () => {
    const name = `${randomUUID()}.png`, fileName = `/images/${name}`
    await fs.writeFile(path.join(root, 'temp', name), 'image')
    const agent = request.agent(app)
    const token = (await agent.get('/auth/csrf-token')).body.csrfToken
    const body = { title: products[0].title, description: 'Audit description', category: 'other', image: { fileName, originalName: 'file.png' }, price: 1 }
    const failed = await agent.post('/product').set('X-CSRF-Token', token).set('Authorization', `Bearer ${admin.generateAccessToken()}`).send(body)
    assert.equal(failed.status, 409)
    await fs.access(path.join(root, 'temp', name))
    await assert.rejects(fs.access(path.join(root, 'images', name)))
    const created = await agent.post('/product').set('X-CSRF-Token', token).set('Authorization', `Bearer ${admin.generateAccessToken()}`).send({ ...body, title: 'Unique image owner' })
    assert.equal(created.status, 201)
    const shared = await Product.create({ ...body, title: 'Shared image reference' })
    const deleted = await agent.delete(`/product/${created.body._id}`).set('X-CSRF-Token', token).set('Authorization', `Bearer ${admin.generateAccessToken()}`)
    assert.equal(deleted.status, 200)
    await fs.access(path.join(root, 'images', name))
    assert.equal((await agent.delete(`/product/${shared.id}`).set('X-CSRF-Token', token).set('Authorization', `Bearer ${admin.generateAccessToken()}`)).status, 200)
    await assert.rejects(fs.access(path.join(root, 'images', name)))
})
