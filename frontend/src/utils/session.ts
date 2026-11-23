// Access tokens are never persisted. Remove cookies from previous app versions.
export function clearLegacyAuthCookie() {
    clearLegacyOrderDraft()
    if (typeof document === 'undefined') return
    document.cookie = 'accessToken=; Max-Age=0; Path=/; SameSite=Lax'
}
export function clearLegacyOrderDraft() {
    try { localStorage.removeItem('persist:order') } catch { /* Storage may be unavailable. */ }
}

export function isSignedOut() {
    try { return sessionStorage.getItem('weblarek:signedOut') === 'true' } catch { return false }
}
export function markSignedOut(value: boolean) {
    try {
        if (value) sessionStorage.setItem('weblarek:signedOut', 'true')
        else sessionStorage.removeItem('weblarek:signedOut')
    } catch { /* Storage may be unavailable. */ }
}
