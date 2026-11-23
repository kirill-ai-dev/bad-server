const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const request = require('supertest')
process.env.TRUSTED_PROXIES = '127.0.0.1,::1'
const { default: app, rateLimitStore, authRateLimitStore } = require('../src/app')
beforeEach(() => { rateLimitStore.resetAll(); authRateLimitStore?.resetAll() })
test('nginx clients have separate quotas and only the closest forwarding hop is used', async () => {
    for (let i = 0; i < 40; i += 1) {
        assert.equal((await request(app).get('/auth/csrf-token').set('X-Forwarded-For', '198.51.100.10')).status, 200)
    }
    assert.equal((await request(app).get('/auth/csrf-token').set('X-Forwarded-For', '198.51.100.10')).status, 429)
    assert.equal((await request(app).get('/auth/csrf-token').set('X-Forwarded-For', '203.0.113.20')).status, 200)
    assert.equal((await request(app).get('/auth/csrf-token').set('X-Forwarded-For', '203.0.113.20, 198.51.100.10')).status, 429)
})
test('untrusted peers cannot supply forwarding addresses', () => {
    const trust = app.get('trust proxy fn')
    assert.equal(trust('192.0.2.1', 0), false)
    assert.equal(trust('127.0.0.1', 0), true)
    assert.equal(trust('127.0.0.1', 1), false)
})
function productionConfig(secure) {
    const env = { ...process.env, NODE_ENV: 'production', COOKIE_SECURE: secure }
    for (const key of ['CSRF_SECRET', 'AUTH_ACCESS_TOKEN_SECRET', 'AUTH_REFRESH_TOKEN_SECRET']) env[key] = randomBytes(32).toString('hex')
    return spawnSync(process.execPath, ['-r', 'ts-node/register', '-e', "require('./src/config')"], { cwd: require('node:path').join(__dirname, '..'), env, encoding: 'utf8' })
}
test('production refuses cookies without Secure and accepts explicit HTTPS configuration', () => {
    assert.notEqual(productionConfig('false').status, 0)
    assert.notEqual(productionConfig('').status, 0)
    assert.equal(productionConfig('true').status, 0)
})

test('repeated failed authentication has a separate stricter quota', async () => {
    for (let i = 0; i < 20; i += 1) {
        assert.equal((await request(app).post('/auth/login').set('X-Forwarded-For', '198.51.100.50').send({})).status, 403)
    }
    assert.equal((await request(app).post('/auth/login').set('X-Forwarded-For', '198.51.100.50').send({})).status, 429)
    assert.equal((await request(app).get('/auth/csrf-token').set('X-Forwarded-For', '198.51.100.50')).status, 200)
})
test('private authorization responses are not cacheable', async () => {
    const res = await request(app).get('/auth/user')
    assert.equal(res.status, 401)
    assert.equal(res.headers['cache-control'], 'no-store')
})
