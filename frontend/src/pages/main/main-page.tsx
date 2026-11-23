import Pagination from '../../components/pagination'
import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import Card from '../../components/card/card'
import Gallery from '../../components/gallery/gallery'
import { useActionCreators } from '../../services/hooks'
import {
    productsActions,
    productsSelector,
} from '../../services/slice/products'

export default function MainPage() {
    const { getProducts } = useActionCreators(productsActions)
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    useEffect(() => {
        let active = true
        getProducts({ page, limit: 10 }).unwrap().then(result => {
            if (active) setTotalPages(Math.max(1, result.pagination.totalPages))
        }).catch(() => undefined)
        return () => { active = false }
    }, [getProducts, page])

    const products = useSelector(productsSelector.selectProducts)

    return (
        <>
        <Gallery>
            {products.map((product) => (
                <Card key={product._id} dataCard={product} component={Link} />
            ))}
        </Gallery>
        {totalPages > 1 && <Pagination currentPage={page} totalPages={totalPages} limit={10}
            onNextPage={() => setPage(value => Math.min(value + 1, totalPages))}
            onPrevPage={() => setPage(value => Math.max(1, value - 1))} />}
        </>
    )
}
