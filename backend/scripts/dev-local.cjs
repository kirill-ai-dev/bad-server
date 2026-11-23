// Isolated development database; only bundled educational fixtures are imported.
const { MongoMemoryServer } = require('mongodb-memory-server')
const mongoose = require('mongoose')
const fs = require('node:fs')
const path = require('node:path')
async function start() {
    process.env.PORT = process.env.PORT || '13000'
    process.env.ORIGIN_ALLOW = process.env.ORIGIN_ALLOW || 'http://localhost:15173'
    const mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } })
    await mongoose.connect(mongo.getUri())
    const Product = require('../src/models/product').default
    const dump = JSON.parse(fs.readFileSync(path.join(__dirname, '../../.dump/weblarek.products.json'), 'utf8'))
    const products = mongoose.mongo.BSON.EJSON.deserialize(dump)
    await Product.insertMany(products)
    const User = require('../src/models/user').default
    const users = JSON.parse(fs.readFileSync(path.join(__dirname, '../../.dump/weblarek.users.json'), 'utf8'))
    await User.insertMany(mongoose.mongo.BSON.EJSON.deserialize(users).map(user => ({ ...user, orders: [], lastOrder: null })))
    if (process.env.LOCAL_TEST_USERS) {
        const accounts = JSON.parse(fs.readFileSync(process.env.LOCAL_TEST_USERS, 'utf8'))
        for (const [index, account] of accounts.entries()) {
            if (!await User.exists({ email: account.email })) await User.create({ ...account, name: 'Test account', roles: [index === 0 ? 'admin' : 'customer'] })
        }
    }
    const { cleanupImages } = require('../src/utils/imageStorage')
    await cleanupImages()
    const cleanupTimer = setInterval(() => { cleanupImages().catch(() => console.error('Image cleanup failed')) }, 60 * 60 * 1000)
    cleanupTimer.unref()
    const app = require('../src/app').default
    const server = app.listen(process.env.PORT, '127.0.0.1', () => console.log(`Local API: http://localhost:${process.env.PORT}`))
    server.requestTimeout = 15000
    server.headersTimeout = 10000
    async function stop() { clearInterval(cleanupTimer); server.close(); await mongoose.disconnect(); await mongo.stop(); process.exit(0) }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
}
start().catch(error => { console.error('Local runtime could not start:', error.name, error.code || 'validation'); process.exit(1) })
