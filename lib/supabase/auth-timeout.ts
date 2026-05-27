/** Max wait for Supabase auth round-trips before treating as unreachable. */
export const SUPABASE_AUTH_TIMEOUT_MS = 4000

type AuthUserResult = {
  data: { user: unknown }
  error: unknown
}

type AuthSessionResult = {
  data: { session: unknown }
  error: unknown
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export async function getUserWithTimeout(
  getUser: () => Promise<AuthUserResult>,
  timeoutMs = SUPABASE_AUTH_TIMEOUT_MS
): Promise<AuthUserResult> {
  try {
    return await withTimeout(getUser(), timeoutMs, 'supabase.auth.getUser')
  } catch {
    return { data: { user: null }, error: null }
  }
}

export async function getSessionWithTimeout(
  getSession: () => Promise<AuthSessionResult>,
  timeoutMs = SUPABASE_AUTH_TIMEOUT_MS
): Promise<AuthSessionResult> {
  try {
    return await withTimeout(getSession(), timeoutMs, 'supabase.auth.getSession')
  } catch {
    return { data: { session: null }, error: null }
  }
}

/**
 * Patch getUser/getSession on the existing auth object (do not replace `auth`).
 * Spreading `auth` drops prototype methods like onAuthStateChange.
 */
export function withAuthTimeouts<T extends { auth: { getUser: () => Promise<AuthUserResult>; getSession: () => Promise<AuthSessionResult> } }>(
  client: T
): T {
  const auth = client.auth
  const getUser = auth.getUser.bind(auth)
  const getSession = auth.getSession.bind(auth)
  auth.getUser = () => getUserWithTimeout(getUser)
  auth.getSession = () => getSessionWithTimeout(getSession)
  return client
}
