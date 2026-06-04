const DEFAULT_AUTH_REDIRECT_PATH = '/'

function containsControlCharacter(value: string) {
  return /[\u0000-\u001F\u007F]/.test(value)
}

export function getSafeAuthRedirectPath(next: string | null | undefined) {
  if (!next || containsControlCharacter(next)) {
    return DEFAULT_AUTH_REDIRECT_PATH
  }

  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return DEFAULT_AUTH_REDIRECT_PATH
  }

  return next
}
