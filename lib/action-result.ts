/**
 * Result values for Server Actions.
 *
 * Next.js replaces the message of an error thrown from a Server Action with a generic
 * one in production builds, so expected failures (validation, permission, rate limits)
 * must be RETURNED, not thrown. Actions return `ActionResult<T>`; client adapters call
 * `unwrapAction()` to turn `{ ok: false }` back into a thrown Error on the client side,
 * where the message survives and existing `catch (e) { showUserError(e.message) }` works.
 *
 * Only `UserFacingError` messages are shown to users. Any other error (DB, network,
 * bugs) is logged server-side and replaced with the action's fallback text so internals
 * never leak.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** An error whose message is safe and useful to show to the user. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserFacingError'
  }
}

export function actionOk<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}

export function actionFail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

/** Map a caught error to a result: user-facing messages pass through, everything else becomes `fallback`. */
export function toActionFailure(err: unknown, fallback: string, logTag = '[action]'): { ok: false; error: string } {
  if (err instanceof UserFacingError) return actionFail(err.message)
  console.error(logTag, err)
  return actionFail(fallback)
}

/** Run `fn` and wrap its outcome; never throws. */
export async function runAction<T>(fallback: string, fn: () => Promise<T>, logTag?: string): Promise<ActionResult<T>> {
  try {
    return actionOk(await fn())
  } catch (err) {
    return toActionFailure(err, fallback, logTag)
  }
}

/** Client side: return the data or throw an Error carrying the user-facing message. */
export function unwrapAction<T>(result: ActionResult<T>): T {
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    throw new Error('Unexpected response from the server. Please try again.')
  }
  if (!result.ok) throw new Error(result.error)
  return result.data
}
