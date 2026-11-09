## What & why

<!-- What changed and why. Link the issue/spec/assessment item. -->

## How

<!-- Approach, key decisions, assumptions. -->

## How it was verified

<!-- Paste commands + results. "Tests pass" without output is not evidence. -->

- [ ] `npm ci`
- [ ] `npm run lint` (0 errors)
- [ ] `npx tsc --noEmit`
- [ ] `npm test`: **N tests ran**, 0 failed (paste the `# tests` / `# pass` / `# fail` lines)
- [ ] `npm run build`
- [ ] Manually checked affected pages/flows (preview URL / screenshots for UI)

## Risk tier

- [ ] Low: docs, tests, internal tooling
- [ ] Medium: product code, dependency bumps, caching
- [ ] High: auth/authz, RLS/permissions, migrations, secrets, CI/CD, payments

Why:

## Database / RLS changes

- [ ] No database changes
- [ ] SQL added under `supabase/` and applied to a non-production project first
- [ ] RLS: every new/changed policy has `WITH CHECK` where rows are written; no column a user must not edit is writable
- [ ] Server-side validation added for any new input (server actions/route handlers are public endpoints)
- [ ] Types/mappers/actions/forms/docs updated together (see `supabase/context.md`)

## How to revert

<!-- Revert commit? Migration down / forward-fix? Env var to unset? -->

## Follow-ups

<!-- Out-of-scope items found while working. -->
