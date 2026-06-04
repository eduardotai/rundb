# Security Policy

RunDB handles user accounts, hardware profiles, report submissions, moderation state, and privileged Supabase operations. Please report security issues privately before public disclosure.

## Sensitive Areas

- Supabase Auth, cookies, sessions, and OAuth callbacks
- Row Level Security policies and SECURITY DEFINER RPCs
- Service-role scripts, ingestion jobs, and admin actions
- Report submission, moderation, voting, and rate limiting
- Stored user content, notes, hardware strings, screenshots, and external media URLs

## Reporting a Vulnerability

If you find a vulnerability, do not open a public issue with exploit details.

Send a private report to the repository owner with:

- Affected route, file, table, policy, or script
- Steps to reproduce
- Expected impact
- Any safe proof-of-concept details
- Suggested mitigation, if known

## Handling Secrets

- Never commit `.env.local`, Supabase service-role keys, OAuth secrets, Steam API keys, IGDB credentials, or production database URLs.
- Use `.env.example` for placeholders only.
- Treat `SUPABASE_SERVICE_ROLE_KEY` as server-only.
- Rotate exposed credentials immediately if they are committed or logged.

## Disclosure

Security fixes should be shipped before detailed public writeups. Public changelog entries should describe the risk and fix without exposing reusable exploit steps.
