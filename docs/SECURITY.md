# Security review

Scope: the code in this repository as of this review. Method: reading the code paths named below plus the automated tests that exercise them (listed per area). This was a **code review by the project's author and an AI assistant, not an independent penetration test**. Nothing here has been tested against a live production deployment.

## Summary

| Area | Result |
|---|---|
| Authentication | Good. Details below. |
| Authorization / user isolation | Good: every query is scoped by owner; cross-user access answers 404. |
| Input validation | Good: strict schemas on every body and query; unknown fields rejected. |
| File uploads | Good: content sniffing, size caps, private storage, signed short-lived links. |
| Rate limiting | Adequate for one instance; per-instance memory counters (see risks). |
| Secrets | Good: validated at startup, never returned or logged, none in the client bundle. |
| Dependencies | 3 known advisories remain, all in `zod` v3 (see risks). |
| Not covered | Email verification, password reset, MFA, social-network OAuth: not built. |

## Authentication

- Passwords hashed with bcrypt (cost 12 by default). Account lockout after `MAX_FAILED_LOGINS` wrong passwords; strict per-IP limiter on register/login/password change (only failed attempts count).
- Access token: HS256 JWT, 15 minutes, algorithm pinned (`none` and other algorithms rejected), issuer checked, held in memory by the browser (not in localStorage).
- Refresh token: random 256-bit value, only its SHA-256 hash is stored, delivered only in an `HttpOnly`, `Secure` (production), `SameSite=Strict` cookie restricted to `/api/v1/auth`. It rotates on use; replaying a stolen old token revokes the whole session.
- Every authenticated request re-checks that the session is not revoked or expired and that the user still exists, so logout and password change take effect immediately.
- CSRF on the cookie-authenticated endpoints (`/auth/refresh`, `/auth/logout`): SameSite=Strict, a required custom header, and an Origin check against `CLIENT_ORIGIN`. All other endpoints use the Authorization header, which a cross-site page cannot set.
- Tests: `auth.test.js`, `ratelimit.test.js`, `e2e-journey.test.js`.

## Authorization and data isolation

- Every module filters by `owner` (helpers in `src/lib/scoped.js`), and the owner is never accepted from the request body (schemas are `.strict()`).
- Another user's record id returns **404**, identical to a missing one, so ids cannot be probed. Ids embedded in other requests (a campaign on a task, a brand on an invoice) are verified to belong to the caller.
- The AI assistant's data tools take no user argument and always run as the signed-in user; tool results exclude contact details, payment instructions and internal ids. AI can only propose three kinds of change, applied after explicit confirmation.
- Tests: `isolation.test.js`, per-module access tests, `ai.test.js`, the isolation step of `e2e-journey.test.js`.

## Input validation

- Zod schemas validate every body, query string and path id; bodies are limited to 100 KB; page sizes are capped (400 on an oversized `limit`).
- Search text is escaped before it reaches a regular expression; Mongo operators in user input are rejected by the schemas (`strictQuery` plus typed fields).
- The invoice download page escapes every typed value and contains no scripts or external requests.
- Tests: validation cases in every module test file; `e2e-journey.test.js` (malformed JSON, oversized body, page cap).

## File uploads

- Size caps per type are enforced while streaming; the allowed list is images, short videos and PDFs only. The real type is detected from the file's magic bytes, and a program or HTML/SVG file renamed to `.png` is refused. Display names are sanitised.
- Files are stored as private resources; the browser gets a signed link valid for `ASSET_TOKEN_TTL_SECONDS` only after an ownership check. Per-user upload rate limit and a per-content file count cap.
- Not done: antivirus scanning, image re-encoding to strip metadata. Do not treat uploaded videos or PDFs as scanned.
- Tests: `media.test.js`.

## Rate limiting

- Global per-IP limit; strict limiter on authentication; per-user upload limiter; per-user and per-minute AI limits plus a daily AI quota.
- Limits are in the API process's memory. They reset on restart and are per instance.

## Secrets

- The environment is validated at startup. In production the server refuses to start with a short or placeholder `JWT_ACCESS_SECRET`, or with local file storage.
- `.env` files are git-ignored (`.env.example` is the only one committed). `VITE_*` variables are public and contain no secrets. The AI key is read only by the server and never returned (tested).
- Logs contain request ids, routes (not query strings), status codes and user ids; never bodies, headers, cookies, tokens or keys.
- Verified: only `client/.env.example` and `server/.env.example` are tracked by git, and `git log --all -- server/.env` shows no history of a real `.env` ever being committed. Local `.env` files exist in the working folder; rotate any credential that has ever been pasted into chat, screenshots or tickets.

## Known risks and limitations

1. **`zod` 3.x advisory (high, GHSA-mrhx-c7xc-m3w5):** validating very large constrained arrays can use a lot of memory. Mitigation in place: 100 KB body limit. Fix requires the zod 4 major upgrade, which changes error formats and was not attempted blind. Plan it as its own change with the full test suite.
2. **Rate limits are per instance** and in memory. Behind several instances, put a limit at the proxy/CDN too.
3. **No email verification, password reset or MFA.** A user who forgets their password cannot recover the account. Registered email addresses are not proven to be owned by the registrant.
4. **No audit log of security events** beyond the structured request log (login failures are visible as `warn` lines with status 401/429).
5. **Same-site deployment is required** for login persistence ([DEPLOYMENT.md](DEPLOYMENT.md)).
6. **Static site headers (CSP etc.) are not set by this project;** configure them at the static host.
7. **No automated browser (UI) tests.** Accessibility and responsive behaviour were reviewed by reading the code only (skip link, focus-managed modals, alert/status roles, labelled controls), not with an assistive-technology audit.
