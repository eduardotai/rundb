# Phase 5: Rollback Plan
**Safe Reversion for Real-Data Rollout (Master Plan Aligned)**

**Core Principle from approved plan**: The `NEXT_PUBLIC_USE_REAL_DATA` flag + adapter in `lib/data.ts` (with universal fallbacks to `lib/mock-data.ts`) was designed for **zero-downtime, low-risk** rollbacks. Real paths **never break the UI** — errors always resolve to mock data with console warnings.

This makes Phase 5 rollback trivial compared to traditional DB cutovers.

## When to Rollback
Trigger immediately on any of:
- Sustained high error rate in Sentry (real-data tagged transactions).
- Mass fallback warnings in logs (`[data] ... falling back to mock` rate > 5% of requests).
- Supabase outage, RLS policy breakage, or auth failures blocking reads/writes.
- Data corruption or incorrect reports visible publicly (e.g. moderation RLS leak).
- Performance degradation (slow queries on reports table despite indexes).
- Abuse / spam wave that rate limits can't contain.
- Critical bug in submission (e.g. tier calc wrong, dup detection bypassed).
- Monitoring alerts firing (DB size explosion, storage costs, MAU fraud).
- Post-deploy: user reports of broken compatibility predictions, missing games, or submit failures.

**Decision authority**: On-call engineer (or lead) — no approval needed for flag flip in emergency.

## Rollback Procedures (Ordered by Speed & Safety)

### 1. Instant Feature Flag Rollback (Primary / Recommended — < 2 minutes)
**This is the designed escape hatch.**

1. In your hosting platform (Vercel, etc.):
   - Update the environment variable for the production deployment:
     `NEXT_PUBLIC_USE_REAL_DATA=false`
   - Redeploy / promote the change (or use instant env var update if supported; for Next.js static flags, usually requires rebuild).
2. (If using edge config / runtime flag later) Toggle without full redeploy.
3. Verify:
   - All pages load using mock data (no Supabase network calls for data layer).
   - No more fallback warnings (or only expected ones).
   - UI fully functional (submit still works via localStorage mock path).
4. Announce: "Rolled back to mock mode for investigation. Real data will return after fix."
5. Post-mortem: root cause in Sentry + Supabase logs. Fix in code or DB. Re-enable only after re-verification against checklist.

**Why it works**:
- `lib/data.ts:35` : `const USE_REAL = process.env.NEXT_PUBLIC_USE_REAL_DATA === 'true'`
- Every public function has `if (USE_REAL) { try real } else / catch { return mock... }`
- Submission: `addUserReport` routes to Server Action only when true; else mock.
- React Query + hooks gracefully handle either.
- Zero schema or data change required.

**Impact**:
- Zero data loss.
- Public users see only approved historical reports from before (mock seed + any previously approved).
- New submissions go to browser localStorage (user reports persist for them).
- Moderation / admin tools fall back to demo mode (localStorage).

### 2. Code / Deployment Rollback (If Flag Change Insufficient)
If the bug is in the adapter code itself or recent non-flag change:

1. Git: `git revert <bad-commit-sha>` or checkout previous known-good tag.
2. Redeploy the previous version (with flag=false as safety).
3. Or: Deploy a hotfix branch that forces flag=false + any code fix.
4. Verify build + smoke test in staging first if possible.

Keep the flag mechanism even in rollback commits.

### 3. Database / Data Rollback (Rare — Only for Corruption)
**Supabase makes this straightforward.**

1. **Immediate mitigation**: Use flag rollback (step 1) to stop new writes to real tables.
2. **Restore**:
   - Supabase Dashboard → Database → Backups (or PITR if enabled).
   - Restore to a point before the bad change (full project restore or selective table via SQL dump + psql/Supabase tools).
   - For granular: Use service_role key + SQL to DELETE/UPDATE specific bad rows (e.g. `DELETE FROM reports WHERE created_at > 'bad-time' AND status='pending';`).
3. Re-ingest games if media or games table was affected: re-run `npm run ingest:games` (idempotent).
4. Re-apply any manual schema tweaks if lost (re-run relevant blocks of `supabase/schema.sql`).
5. Re-enable flag only after data audit (`SELECT count(*) FROM reports WHERE status='approved';` etc.).

**Prevention**: PITR enabled + regular schema exports. Never run destructive migrations without backup.

### 4. Auth / RLS Specific Rollback
- If RLS policies broken: Temporarily disable problematic policies via SQL (or restore from backup).
  Example (emergency only):
  ```sql
  -- Temporarily broaden or drop a bad policy
  DROP POLICY IF EXISTS "Moderators can read all reports for moderation" ON reports;
  -- Then recreate correct one after fix
  ```
- Reset user roles if needed: `UPDATE profiles SET role='user' WHERE ...;`
- For auth provider issues: Disable problematic provider in Supabase Auth dashboard (users fall back to anon or other).
- Re-enable after testing with real flag in staging.

### 5. Full Environment / Infra Rollback
- If Supabase project itself is compromised (very rare): 
  - Flag rollback first (stops traffic).
  - Contact Supabase support + use their restore tools.
  - Stand up a fresh Supabase project from `supabase/schema.sql` + latest backup, update all env keys, re-seed via ingestion script.
- Hosting provider rollback: Use previous deployment snapshot.

## Communication & Coordination
- **Internal**: Post in #incidents (or equivalent): "Phase 5 rollback initiated via flag=false at [time]. Investigating [link to Sentry alert]. ETA for re-enable: TBD."
- **Users** (if public impact): Status page or in-app banner: "Temporarily using demo data while we resolve a backend issue. Your previous submissions are safe."
- **After rollback**:
  - Update the Production Readiness Checklist with "rollback event" note + link to incident.
  - Rehearse the exact steps that failed.
  - Only re-enable after full re-run of checklist + E2E harness + canary.

## Testing the Rollback (Pre-Production Requirement)
**MANDATORY before Phase 5 go-live**:
1. In staging with flag=true: deliberately break Supabase connection (wrong key or network block).
   - Confirm: all real paths fall back cleanly, UI never crashes, users can still submit/browse (mock).
2. Flip flag=false in staging prod-like env → instant switch, no errors.
3. Simulate RLS breakage (temporarily drop a policy) → fallbacks + logs.
4. Test moderation path under flag=false (admin demo mode active).
5. Document timings and any gotchas in this plan.
6. Rehearse full DB restore drill (small test project).

**Evidence**: Attach logs/screenshots to the checklist or incident tracker.

## Post-Rollback Recovery Checklist
- [ ] Root cause identified (Sentry + Supabase logs + data.ts traces).
- [ ] Fix implemented + tested in staging (flag=true).
- [ ] E2E harness (`scripts/phase5-e2e-real-data.ts`) green against fixed state.
- [ ] Monitoring alerts cleared.
- [ ] Data integrity verified (sample queries on reports/games).
- [ ] Re-enable flag via canary (internal first).
- [ ] 24h observation period.
- [ ] Update runbooks / this plan with lessons.
- [ ] Close incident.

## Rollback Drills Schedule
- Quarterly (or after any major schema / adapter change).
- Before every major Phase 5+ milestone.
- After any incident.

## Appendix: Common Failure Scenarios & Exact Commands
- **High fallbacks**: Check Supabase → Logs (filter project ref + errors). Look for "permission denied", "relation does not exist", rate limits.
- **Submit failing**: `app/actions/reports.ts` + profile.role check + rate limit queries.
- **Images 404**: Verify Storage bucket public + policy + `gameMediaLoader` + Next remotePatterns. Re-upload via ingestion.
- **Admin can't see pending**: Confirm moderator RLS policy + user's profile row has correct role.
- **Performance**: Supabase Query Performance advisor + our indexes (`idx_reports_game_created` etc.).

**Flag is truth**: As long as the adapter + flag exist, rollback is a configuration change, not a code or data surgery.

**This plan makes Phase 5 low-risk by design.**

**Last updated:** 2026-05-26 (PR 6 / Agent 6 final verification + E2E image extensions + 6-agent swarm). Update this document whenever the data adapter, media pipeline (gameMediaLoader / game_media), or schema changes. Cross-reference `VERIFICATION_SWARM_PROMPTS.md` and the extended `scripts/phase5-e2e-real-data.ts`.
