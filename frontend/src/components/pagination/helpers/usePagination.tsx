import { AsyncThunk } from '@reduxjs/toolkit'
import { AppDispatch } from '@store/store'
import { WebLarekAPI } from '../../../utils/weblarek-api'
import { useDispatch, useSelector } from '@store/hooks'
import { RootState } from '@store/store'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

interface PaginationResult<U> {
    data: U[]
    totalPages: number
    currentPage: number
    limit: number
    nextPage: () => void
    prevPage: () => void
    setPage: (page: number) => void
    setLimit: (limit: number) => void
}

const usePagination = <T extends { pagination: { totalPages: number } }, U>(
    asyncAction: AsyncThunk<T, Record<string, unknown>, { state: RootState; dispatch: AppDispatch; extra: WebLarekAPI }>,
    selector: (state: RootState) => U[],
    defaultLimit: number
): PaginationResult<U> => {
    const dispatch = useDispatch()
    const data = useSelector(selector)
    const [searchParams, setSearchParams] = useSearchParams()
    const [totalPages, setTotalPages] = useState<number>(1)

    const currentPage = Math.min(
        Number(searchParams.get('page')) || 1,
        totalPages
    )

    const limit = Number(searchParams.get('limit')) || defaultLimit

    useEffect(() => {
        let active = true
        const params = Object.fromEntries(searchParams.entries())
        dispatch(asyncAction({ ...params, page: currentPage, limit })).unwrap()
            .then(response => {
                if (active) setTotalPages(Math.max(1, response.pagination.totalPages))
            }).catch(() => { /* The slice retains the request error. */ })
        return () => { active = false }
    }, [dispatch, asyncAction, currentPage, limit, searchParams])

    const updateURL = (newParams: Record<string, number | undefined>) => {
        const updatedParams = new URLSearchParams(searchParams)
        Object.entries(newParams).forEach(([key, value]) => {
            if (value !== undefined) updatedParams.set(key, value.toString())
            else updatedParams.delete(key)
        })
        setSearchParams(updatedParams)
    }

    const nextPage = () => {
        if (currentPage < totalPages) {
            updateURL({ page: currentPage + 1, limit })
        }
    }

    const prevPage = () => {
        if (currentPage > 1) {
            updateURL({ page: currentPage - 1, limit })
        }
    }

    const setPage = (page: number) => {
        const newPage = Math.max(1, Math.min(page, totalPages))
        updateURL({ page: newPage, limit })
    }

    const setLimit = (newLimit: number) => {
        updateURL({ page: 1, limit: newLimit }) // При изменении лимита возвращаемся на первую страницу
    }

    return {
        data,
        totalPages,
        currentPage,
        limit,
        nextPage,
        prevPage,
        setPage,
        setLimit,
    }
}

export default usePagination
