import express from 'express'

export default function serveStatic(baseDir: string) {
    return express.static(baseDir, {
        dotfiles: 'deny',
        index: false,
        maxAge: '1h',
        redirect: false,
    })
}
