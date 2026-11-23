import sanitizeHtml from 'sanitize-html'

export const sanitizeComment = (value: string) =>
    sanitizeHtml(value, {
        allowedTags: [
            'p',
            'br',
            'b',
            'strong',
            'i',
            'em',
            'u',
            'a',
            'ul',
            'ol',
            'li',
        ],
        allowedAttributes: { a: ['href', 'title'] },
        allowedSchemes: ['http', 'https', 'mailto'],
        allowProtocolRelative: false,
    })
