import { NextFunction, Request, Response } from 'express'
import { constants } from 'http2'
import { Error as MongooseError } from 'mongoose'
import BadRequestError from '../errors/bad-request-error'
import ConflictError from '../errors/conflict-error'
import NotFoundError from '../errors/not-found-error'
import Product from '../models/product'
import {
    stageImage,
    removeUnreferencedImage,
    withImageStorageLock,
} from '../utils/imageStorage'

// GET /product
const getProducts = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { page = 1, limit = 5 } = req.query
        const options = {
            skip: (Number(page) - 1) * Number(limit),
            limit: Number(limit),
        }
        const products = await Product.find({}, null, options)
        const totalProducts = await Product.countDocuments({})
        const totalPages = Math.ceil(totalProducts / Number(limit))
        return res.send({
            items: products,
            pagination: {
                totalProducts,
                totalPages,
                currentPage: Number(page),
                pageSize: Number(limit),
            },
        })
    } catch (err) {
        return next(err)
    }
}

// POST /product
const createProduct = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const { description, category, price, title, image } = req.body

        const product = await withImageStorageLock(async () => {
            const staged = await stageImage(image.fileName)
            try {
                return await Product.create({
                    description,
                    image,
                    category,
                    price,
                    title,
                })
            } catch (error) {
                await staged.rollback()
                throw error
            }
        })
        return res.status(constants.HTTP_STATUS_CREATED).send(product)
    } catch (error) {
        if (error instanceof MongooseError.ValidationError) {
            return next(new BadRequestError(error.message))
        }
        if (error instanceof Error && error.message.includes('E11000')) {
            return next(
                new ConflictError('Товар с таким заголовком уже существует')
            )
        }
        return next(error)
    }
}

// PUT /product
const updateProduct = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const { productId } = req.params
        const { image } = req.body

        const product = await withImageStorageLock(async () => {
            const old = await Product.findById(productId).orFail(
                () => new NotFoundError('Нет товара по заданному id')
            )
            const staged =
                image && image.fileName !== old.image.fileName
                    ? await stageImage(image.fileName)
                    : undefined
            let updated
            try {
                updated = await Product.findByIdAndUpdate(
                    productId,
                    { $set: req.body },
                    { runValidators: true, new: true }
                ).orFail(() => new NotFoundError('Нет товара по заданному id'))
            } catch (error) {
                await staged?.rollback()
                throw error
            }
            if (staged)
                await removeUnreferencedImage(old.image.fileName).catch(
                    () => undefined
                )
            return updated
        })
        return res.send(product)
    } catch (error) {
        if (error instanceof MongooseError.ValidationError) {
            return next(new BadRequestError(error.message))
        }
        if (error instanceof MongooseError.CastError) {
            return next(new BadRequestError('Передан не валидный ID товара'))
        }
        if (error instanceof Error && error.message.includes('E11000')) {
            return next(
                new ConflictError('Товар с таким заголовком уже существует')
            )
        }
        return next(error)
    }
}

// DELETE /product
const deleteProduct = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const { productId } = req.params
        const product = await withImageStorageLock(async () => {
            const deleted = await Product.findByIdAndDelete(productId).orFail(
                () => new NotFoundError('Нет товара по заданному id')
            )
            await removeUnreferencedImage(deleted.image.fileName).catch(
                () => undefined
            )
            return deleted
        })
        return res.send(product)
    } catch (error) {
        if (error instanceof MongooseError.CastError) {
            return next(new BadRequestError('Передан не валидный ID товара'))
        }
        return next(error)
    }
}

export { createProduct, deleteProduct, getProducts, updateProduct }
