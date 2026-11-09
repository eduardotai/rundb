# supabase/

The database schema is defined by **`migrations/`** and nothing else. Any database (local,
preview, a new project) must be rebuildable from zero with `supabase db reset`. CI job `db`
does this on every PR.

| Path | What |
|---|---|
| `config.toml` | Supabase CLI config for the local stack (`supabase init` defaults, `project_id = "rundb"`, Postgres 17, storage buckets that mirror production). It does not change the hosted project unless someone runs `supabase config push`. |
| `migrations/` | Ordered, versioned migrations. Source of truth. |
| `tests/smoke.sql` | Post-reset checks: tables, RLS on every public table, key functions/policies/triggers, privilege shape, and a few behaviors (rolled back). |
| `tests/policies.sql` | RLS/privilege behavior tests as anon, owner, other user and moderator (positive and negative cases, rolled back). |
| `tests/schema-signature.sql` | Read-only catalog signature (no table data) used to diff two databases for drift. |
| `legacy/` | The old hand-applied `incremental-*.sql` scripts. **History only, do not apply.** Their effects are in `migrations/`. |
| `email-templates/` | Supabase Auth email templates. |

## Local workflow (needs Docker)

```bash
supabase db start      # Postgres only; applies migrations to an empty volume
supabase db reset      # drop and re-apply every migration from zero
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -X -v ON_ERROR_STOP=1 -f supabase/tests/smoke.sql
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -X -v ON_ERROR_STOP=1 -f supabase/tests/policies.sql
supabase migration new <name>   # new migration file; never edit one production already has
```

The Supabase CLI v3 targets the local stack by default. Hosted commands need `--remote`.

## How the baseline was built (2026-11-09)

`schema.sql` was truncated in commit d026108 (764 → 1 line) and later rewritten as an
incomplete 70-line file, so it could not recreate the database. It was removed instead of
restored: even the last full version (`git show ea15474:supabase/schema.sql`) did not match
production. Production had been built from an earlier `schema.sql` plus a subset of the
incremental scripts and some manual changes.

1. Production's schema was read through read-only catalog queries (`tests/schema-signature.sql`
   plus function definitions; no table data).
2. The schema was replayed from git history on a scratch Postgres 17.11 (same version as
   production) until its signature matched production line for line. That took the 2026-05-27
   `schema.sql`, the incremental scripts, and the manual changes observed in production.
3. The result was exported with `pg_dump --schema-only` into
   `20261109000000_baseline_prod_snapshot.sql`. On a fresh database, the baseline alone gives a
   signature identical to production (355 lines: columns and order, defaults, constraint names,
   indexes, RLS, 25 policies, function bodies and config, EXECUTE and table grants, triggers,
   comments, enums, extensions).
4. Repo changes that production never received follow as separate migrations:

| Migration | Source | Effect when applied to production |
|---|---|---|
| `20261109000100_sync_function_bodies_with_repo` | repo versions of `handle_new_user` and `recompute_report_vote_totals` | new signups get `username` from the signup nickname instead of the OAuth `full_name`; votes no longer re-approve rejected/staff-flagged reports |
| `20261109000200_rls_performance` | `incremental-rls-performance.sql` | adds `is_moderator_or_admin()`, moderator read/update policies on `reports`, FK/hot-path indexes, `(select auth.uid())` policy rewrites |
| `20261109000300_hardware_catalog_igpu` | `incremental-hardware-catalog-igpu.sql` | adds `hardware_catalog.has_igpu`, `igpu_canonical` |
| `20261109000400_admin_moderation` | `incremental-admin-moderation.sql` | adds `report_images.status` (**existing images become `pending`, hidden from the public until approved**), `is_admin()`, `moderation_log`, and the moderation RPCs that `lib/server/admin-moderation.ts` already calls |
| `20261109000500_security_hardening` | PR 4 | column grants on `profiles` (public columns only; own private columns via `get_my_profile()`), Steam links written only server-side, owner image/vote policies with `WITH CHECK`, no self-votes, no raw owner edits of reports, `EXECUTE` revoked on internal functions, no `TRUNCATE`/`TRIGGER`/`REFERENCES`/`MAINTAIN` for API roles, anon read-only |

Platform-owned objects are not in migrations: roles, the `auth`/`storage` schemas,
`pgcrypto`/`uuid-ossp`, the `ensure_rls` event trigger (`public.rls_auto_enable`), and bucket
rows (declared in `config.toml`).

## Production status and runbook (owner approval required)

Production history (2026-11-09): baseline `20261109000000` recorded as applied (not run), then
`…0100` to `…0400` applied in order with the owner's approval. The two pre-baseline history rows
(`20260915122645`, `20260915122706`) were removed because the baseline contains their effects.
After that the production signature equals a fresh `db reset` of `main`.

Next migrations:

```bash
supabase link --project-ref <project-ref>
supabase migration list --remote          # local and remote must match up to the last applied version
supabase db push --remote --dry-run       # review exactly which files will run
supabase db push --remote
psql "$PROD_DB_URL" -X -tA -f supabase/tests/schema-signature.sql > prod.sig   # diff against CI's "Schema signature" step
```

Never run `supabase db reset --remote` against production: it drops all user schemas.
