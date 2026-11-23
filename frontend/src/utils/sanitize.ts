import DOMPurify from 'dompurify'
export const sanitizeComment = (value: string) =>
    DOMPurify.sanitize(value, {
        ALLOWED_TAGS: [
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
        ALLOWED_ATTR: ['href', 'title'],
    })
