/**
 * Cast or clear the caller's vote on a report.
 *
 * Takes the caller's RLS-scoped Supabase client (votes are written as the user so the
 * report_votes policies apply: no self-votes, vote IN (-1, 1)). Returns an ActionResult
 * so the friendly messages survive production Next.js. Tested in tests/report-vote.test.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { actionFail, actionOk, type ActionResult } from '@/lib/action-result'
import { isUuid } from '@/lib/admin-logic'

export type VoteValue = 1 | -1 | 0

export interface Voter {
  id: string
  email?: string | null
  is_anonymous?: boolean | null
}

export async function castReportVote(
  client: SupabaseClient,
  user: Voter | null,
  reportId: unknown,
  value: unknown,
): Promise<ActionResult<null>> {
  if (!user?.id || !user.email || user.is_anonymous) return actionFail('You must sign in to vote on reports.')
  if (!isUuid(reportId)) return actionFail('Report not found.')
  if (value !== 1 && value !== -1 && value !== 0) return actionFail('Invalid vote.')

  const { error } =
    value === 0
      ? await client.from('report_votes').delete().eq('report_id', reportId).eq('user_id', user.id)
      : await client
          .from('report_votes')
          .upsert({ report_id: reportId, user_id: user.id, vote: value }, { onConflict: 'report_id,user_id' })

  if (error) {
    console.error('[castReportVote] error', error)
    // 42501 = RLS rejected the row: the report belongs to the voter (self-votes are blocked in the DB).
    if ((error as { code?: string }).code === '42501') return actionFail("You can't vote on your own report.")
    // 23503 = FK violation: the report no longer exists.
    if ((error as { code?: string }).code === '23503') return actionFail('Report not found.')
    return actionFail('Failed to register vote. Please try again.')
  }
  return actionOk(null)
}
