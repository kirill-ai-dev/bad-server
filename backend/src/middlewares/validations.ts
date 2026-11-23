import { Joi, celebrate } from 'celebrate'
import { RequestHandler } from 'express'
import { sanitizeComment } from '../utils/sanitize'

export const phoneRegExp = /^\+?[0-9 ()-]{7,30}$/
export enum PaymentType {
    Card = 'card',
    Online = 'online',
}
const text = (max = 200) => Joi.string().max(max).trim()
const id = Joi.string().hex().length(24).required()
const email = Joi.string().email().max(254)
const password = Joi.string()
    .min(6)
    .max(72)
    .custom((value, helpers) =>
        Buffer.byteLength(value, 'utf8') <= 72
            ? value
            : helpers.error('any.invalid')
    )
const phone = Joi.string().max(31).pattern(phoneRegExp)
const image = Joi.object({
    fileName: Joi.string()
        .max(200)
        .pattern(/^\/(?:images\/)?[a-zA-Z0-9_-]+\.(?:png|jpe?g|gif|webp|svg)$/)
        .required(),
    originalName: text(255).required(),
})
const product = {
    title: text(30).min(2),
    image,
    category: text(100),
    description: text(5000),
    price: Joi.number().min(0).max(100000000).allow(null),
}
export const validateProductBody = celebrate({
    body: Joi.object(product).fork(
        ['title', 'image', 'category', 'description'],
        (schema) => schema.required()
    ),
})
export const validateProductUpdateBody = celebrate({
    body: Joi.object(product).min(1),
})
export const validateObjId = celebrate({
    params: Joi.object({ productId: id }),
})
export const validateCustomerId = celebrate({ params: Joi.object({ id }) })
export const validateOrderNumber = celebrate({
    params: Joi.object({
        orderNumber: Joi.number()
            .integer()
            .min(1)
            .max(Number.MAX_SAFE_INTEGER)
            .required(),
    }),
})
export const validateUserBody = celebrate({
    body: Joi.object({
        name: text(30).min(2),
        email: email.required(),
        password: password.required(),
    }),
})
export const validateAuthentication = celebrate({
    body: Joi.object({
        email: email.required(),
        password: password.required(),
    }),
})
export const validateUserUpdate = celebrate({
    body: Joi.object({ name: text(30).min(2), email, phone }).min(1),
})
export const validateOrderUpdate = celebrate({
    body: Joi.object({
        status: Joi.string()
            .valid('new', 'delivering', 'completed', 'cancelled')
            .required(),
    }),
})
export const validateOrderBody = celebrate({
    body: Joi.object({
        items: Joi.array().items(id).min(1).max(100).unique().required(),
        payment: Joi.string()
            .valid(...Object.values(PaymentType))
            .required(),
        email: email.required(),
        phone: phone.required(),
        address: text(500).required(),
        total: Joi.number().min(0).max(100000000).required(),
        comment: text(5000)
            .allow('')
            .custom((value) => sanitizeComment(value)),
    }),
})
const query = {
    page: Joi.number().integer().min(1).max(10000),
    limit: Joi.number().integer().min(1),
    search: text(100).allow(''),
    sortField: Joi.string().valid(
        'createdAt',
        'orderNumber',
        'status',
        'totalAmount',
        'name',
        'email',
        'lastOrderDate',
        'orderCount'
    ),
    sortOrder: Joi.string().valid('asc', 'desc'),
    status: Joi.string()
        .valid('new', 'delivering', 'completed', 'cancelled')
        .allow(''),
    ...Object.fromEntries(
        [
            'registrationDateFrom',
            'registrationDateTo',
            'lastOrderDateFrom',
            'lastOrderDateTo',
            'orderDateFrom',
            'orderDateTo',
        ].map((key) => [key, Joi.date().iso().allow('')])
    ),
    ...Object.fromEntries(
        [
            'totalAmountFrom',
            'totalAmountTo',
            'orderCountFrom',
            'orderCountTo',
        ].map((key) => [key, Joi.number().min(0).max(100000000).allow('')])
    ),
}
export const validateQuery = celebrate({ query: Joi.object(query) })
export const normalizePagination: RequestHandler = (req, _res, next) => {
    if (req.query.limit)
        req.query.limit = String(Math.min(Number(req.query.limit), 10))
    next()
}
