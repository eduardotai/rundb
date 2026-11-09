/**
 * Focused input sanitization utilities.
 *
 * === Usage Pattern (apply this everywhere for user text input) ===
 *
 * 1. Forms using Zod + react-hook-form:
 *    - Add .max() limits
 *    - Use .transform(v => sanitizeFullName(v)) for usernames/nicks + hardware strings
 *    - Use sanitizeEmail / sanitizePassword where appropriate
 *
 * 2. Manual forms / onClick saves (no Zod):
 *    - Sanitize right before saving/persisting:
 *      const safeCpu = sanitizeFullName(cpu);
 *
 * 3. Search / filter inputs:
 *    - Sanitize onChange or before using the value.
 *
 * These functions strip dangerous characters, normalize whitespace,
 * and apply hard length caps. They are intentionally simple and focused.
 *
 * When building new features (forms, search, user content, admin tools, etc.),
 * always run user-controlled strings through the appropriate sanitizer.
 */

/**
 * Sanitize email:
 * - Lowercase (standard)
 * - Trim
 * - Hard cap at 254 chars (RFC limit)
 * - Remove obviously bad characters
 */
export function sanitizeEmail(raw: string): string {
  let email = raw.trim().toLowerCase();
  email = email.replace(/[^a-z0-9@._+-]/g, '');

  return email.length > 254 ? email.slice(0, 254) : email;
}

/**
 * Sanitize password:
 * - Trim
 * - Hard cap at 128 chars (prevents abuse with huge strings)
 */
export function sanitizePassword(raw: string): string {
  const pwd = raw.trim();
  return pwd.length > 128 ? pwd.slice(0, 128) : pwd;
}

/**
 * Sanitize display names / usernames / nicks / hardware model strings (most important to control because they can be displayed later):
 * - Trim + collapse whitespace
 * - Allow apostrophes, common punctuation, letters, marks, digits, spaces, -_. (friendly for gamer nicks + hardware like "Ryzen 7 7800X3D")
 * - Hard cap at `maxLength` chars (default 80; report free-text fields pass their own cap)
 * - Strip dangerous characters + neutralize links to prevent malicious injection
 */
export function sanitizeFullName(raw: string, maxLength = 80): string {
  let name = raw
    .trim()
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')           // remove control chars
    .replace(/[<>"`]/g, '')                         // strip dangerous XSS chars (keep ' for names like Baldur's Gate)
    .replace(/https?:\/\/|www\.|javascript:|data:|vbscript:/gi, '') // neutralize links / protocols
    .replace(/[^\p{L}\p{M}\p{N}\s\-'.]/gu, '')      // allow safe name chars + digits for hardware/driver strings
    .replace(/\s+/g, ' ');                          // collapse spaces

  if (name.length > maxLength) name = name.slice(0, maxLength);
  return name.trim();
}

/**
 * Sanitize free text in reports (notes, issues, tweaks, custom settings notes).
 *
 * Unlike sanitizeFullName this keeps normal punctuation (`, : ; % + ( ) / ! ? & # @ = *`),
 * because tweaks read like "DLSS: Quality, FG on (60%)". XSS safety does not come from
 * stripping punctuation: report text is only rendered as React text children (escaped;
 * see tests/report-text-render.test.ts, which forbids dangerouslySetInnerHTML outside the
 * repo-docs dashboard). Defense in depth on top of that:
 * - control and invisible format characters are removed (incl. bidi overrides / zero-width)
 * - `<`, `>` and backticks are removed so the text is inert even in an HTML/markdown context
 * - script-capable URL schemes (`javascript:`, `vbscript:`, `data:` directly followed by a
 *   payload) are neutralized; plain http(s) links stay visible as text and send the report
 *   to moderator review (lib/report-input.ts)
 * - whitespace is collapsed and the result capped at `maxLength`
 */
export function sanitizeReportText(raw: string, maxLength: number): string {
  let text = raw
    .replace(/[\p{Cc}\p{Cf}\p{Co}]/gu, ' ') // control, format (bidi, zero-width), private use
    .replace(/[<>`]/g, '');                 // markup / template delimiters
  // Script-capable schemes; repeat so nested input ("javajavascript:script:") can't reassemble one.
  const scheme = /(?:javascript|vbscript|\bdata)\s*:(?=\S)/gi;
  for (let prev = ''; prev !== text; ) {
    prev = text;
    text = text.replace(scheme, '');
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > maxLength) text = text.slice(0, maxLength).trimEnd();
  return text;
}

/**
 * Sanitize search query (lightweight, permissive for free-text search / filter inputs):
 * - Allows spaces, punctuation, digits, unicode letters, apostrophes (Baldur's Gate 3, etc.)
 * - Strips control characters + dangerous XSS chars (< > " `)
 * - Neutralizes links/protocols to prevent malicious URL injection while still allowing normal game searches
 * - Does NOT trim or collapse whitespace: this preserves user typing experience (trailing space while typing next word).
 * - Hard cap at 120 chars to prevent abuse.
 */
export function sanitizeSearchQuery(raw: string): string {
  let query = raw
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')           // remove control chars
    .replace(/[<>"`]/g, '')                         // strip dangerous XSS chars (keep ' )
    .replace(/https?:\/\/|www\.|javascript:|data:|vbscript:/gi, ''); // neutralize links / protocols

  if (query.length > 120) query = query.slice(0, 120);
  return query;
}
