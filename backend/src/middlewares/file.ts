import multer from 'multer'

export default multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
    fileFilter: (_req, file, cb) =>
        cb(
            null,
            ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(
                file.mimetype
            )
        ),
})
