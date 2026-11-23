import { Router } from 'express'
import {
    deleteCustomer,
    getCustomerById,
    getCustomers,
    updateCustomer,
} from '../controllers/customers'
import auth from '../middlewares/auth'
import {
    validateCustomerId,
    validateUserUpdate,
} from '../middlewares/validations'

const customerRouter = Router()

customerRouter.get('/', auth, getCustomers)
customerRouter.get('/:id', auth, validateCustomerId, getCustomerById)
customerRouter.patch(
    '/:id',
    auth,
    validateCustomerId,
    validateUserUpdate,
    updateCustomer
)
customerRouter.delete('/:id', auth, validateCustomerId, deleteCustomer)

export default customerRouter
