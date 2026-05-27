/**
 * Focused input sanitization utilities.
 *
 * === Usage Pattern (apply this everywhere for user text input) ===
 *
 * 1. Forms using Zod + react-hook-form:
 *    - Add .max() limits
 *    - Use .transform(v => sanitizeFullName(v)) for names/hardware strings
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
  let pwd = raw.trim();
  return pwd.length > 128 ? pwd.slice(0, 128) : pwd;
}

/**
 * Sanitize full name (most important to control because it can be displayed later):
 * - Trim + collapse whitespace
 * - Allow apostrophes and common punctuation needed for real names (Baldur's Gate, etc.)
 * - Hard cap at 80 chars
 * - Strip dangerous characters + neutralize links to prevent malicious injection
 */
export function sanitizeFullName(raw: string): string {
  let name = raw
    .trim()
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')           // remove control chars
    .replace(/[<>"`]/g, '')                         // strip dangerous XSS chars (keep ' for names like Baldur's Gate)
    .replace(/https?:\/\/|www\.|javascript:|data:|vbscript:/gi, '') // neutralize links / protocols
    .replace(/[^\p{L}\p{M}\s\-'.]/gu, '')           // allow only safe name chars
    .replace(/\s+/g, ' ');                          // collapse spaces

  if (name.length > 80) name = name.slice(0, 80);
  return name.trim();
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