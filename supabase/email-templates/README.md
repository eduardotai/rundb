# RunDB Supabase Email Templates

Branded, email-client-safe HTML templates for the transactional emails Supabase
Auth sends. The templates use a clean light email shell with a RunDB dark header,
cyan CTA, table layout, and inline styles so they render reliably in Gmail,
Outlook, Apple Mail, and mobile inboxes.

| File | Supabase template | Suggested subject |
| --- | --- | --- |
| `confirm-signup.html` | **Confirm signup** | `Confirm your RunDB account` |
| `reset-password.html` | **Reset password** | `Reset your RunDB password` |

## How To Apply

This project uses a hosted Supabase instance, so email templates are managed in
the Supabase dashboard instead of a local `supabase/config.toml`. These files are
the version-controlled source of truth; paste their HTML into the dashboard to
deploy them.

1. Open your Supabase project.
2. Go to **Authentication > Emails > Templates**.
3. Select the matching template.
4. Set the subject from the table above.
5. Paste the full HTML file into **Message body (HTML)**.
6. Click **Save**.
7. Send a test sign-up and password reset to verify rendering.

## Template Variables

Supabase substitutes these at send time:

- `{{ .ConfirmationURL }}` - the confirmation or reset link.
- `{{ .Token }}` - a 6-digit OTP code, if you switch to code-based flows.
- `{{ .SiteURL }}` - your configured Site URL.
- `{{ .Email }}` - the recipient's email.

Make sure **Site URL** and **Redirect URLs** under
**Authentication > URL Configuration** point at the deployed domain. Otherwise,
`{{ .ConfirmationURL }}` can point at localhost.

## Editing Notes

- Keep the layout table-based with inline styles only.
- Avoid external images and web fonts; many inboxes block or strip them.
- Keep the CTA as a table cell with `bgcolor` plus a padded link for Outlook.
- Keep the hidden preheader near the top of the body for inbox preview text.
