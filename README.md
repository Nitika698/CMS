# CreatorDesk

Content and business management workspace for influencers. This repository currently contains the **application foundation**: backend skeleton with health checks and MongoDB connection handling, and a responsive frontend shell with placeholders for every module. Business features are not built yet; see `docs/PLAN.md` for the full plan and roadmap.

## Stack
- **Client:** React 18, Vite, Tailwind CSS v4, React Router, lucide-react (`client/`)
- **Server:** Node.js, Express, Mongoose, Zod (env validation), Helmet, CORS, rate limiting (`server/`)
- **Database:** MongoDB (local or Atlas)

## Prerequisites
- Node.js 20+ (developed on Node 24) and npm
- A MongoDB instance: local (`mongodb://127.0.0.1:27017`) or an Atlas connection string

## Setup
```bash
npm install                      # installs both workspaces
cp server/.env.example server/.env   # Windows PowerShell: Copy-Item server/.env.example server/.env
cp client/.env.example client/.env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # paste into JWT_ACCESS_SECRET in server/.env
```
`JWT_ACCESS_SECRET` is **required** (>= 32 chars); the server refuses to start without it. Edit `server/.env` if your MongoDB is not at the default address. `.env` files are git-ignored; never commit real credentials.

## Run
```bash
npm run dev          # API on :5001 and client on :5173 (Vite picks the next free port if busy)
npm run dev:server   # API only
npm run dev:client   # client only
```

## Scripts
| Command | What it does |
|---|---|
| `npm run lint` | ESLint over the whole repo |
| `npm test` | Server tests (Node test runner + supertest). **Needs a local MongoDB**: uses the throw-away database `creatordesk-test` (override with `MONGODB_URI_TEST`; the name must end in `-test`), which is wiped on every run |
| `npm run build` | Production build of the client into `client/dist` |
| `npm run check` | lint + test + build |
| `npm start` | Start the API in production mode |

## Environment variables
**`server/.env`** (see `server/.env.example`)
| Variable | Purpose | Default |
|---|---|---|
| `NODE_ENV` | `development` / `test` / `production` | `development` |
| `PORT` | API port | `5001` |
| `CLIENT_ORIGIN` | Allowed browser origins, comma-separated | `http://localhost:5173` |
| `MONGODB_URI` | MongoDB connection string (**required**) | â€” |
| `DB_RETRY_SECONDS` | Delay between reconnect attempts | `5` |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | Global rate limit | `60000`, `300` |
| `TRUST_PROXY` | Number of reverse proxies in front of the API (correct client IPs for rate limits) | `0` |
| `JWT_ACCESS_SECRET` | Signs access tokens (**required**, >= 32 chars, placeholder rejected in production) | — |
| `ACCESS_TOKEN_TTL_MINUTES` / `REFRESH_TOKEN_TTL_DAYS` | Token lifetimes | `15` / `30` |
| `COOKIE_SECURE` | `Secure` flag on the refresh cookie (on by default in production) | auto |
| `BCRYPT_COST` | Password hashing cost | `12` |
| `MAX_FAILED_LOGINS` / `LOCKOUT_MINUTES` | Account lockout after repeated wrong passwords | `5` / `15` |
| `AUTH_RATE_LIMIT_WINDOW_MS` / `AUTH_RATE_LIMIT_MAX` | Failed register/login/password-change attempts allowed per IP | `900000` / `10` |

**`client/.env`** (public values only; anything `VITE_*` is visible in the browser)
| Variable | Purpose | Default |
|---|---|---|
| `VITE_API_BASE_URL` | API base path/URL | `/api/v1` (uses the dev proxy) |
| `DEV_API_TARGET` | Dev-only proxy target (read by `vite.config.js`, not shipped) | `http://localhost:5001` |

The server refuses to start with an invalid environment and prints which variable is wrong (never its value).

## Authentication & data isolation
- **Passwords:** bcrypt (cost 12), 10-72 chars. Never stored, logged or returned. Responses use an allow-list serializer (`toPublicUser`).
- **Tokens:** a 15-minute access JWT kept **in browser memory only** (sent as `Authorization: Bearer`), plus an opaque refresh token in an **HttpOnly, SameSite=Strict** cookie scoped to `/api/v1/auth`, stored server-side only as a SHA-256 hash. Each refresh rotates the token; replaying an old one after a short grace window revokes the session. Logout, password change and "sign out of all devices" take effect immediately because every request also checks the session is still active.
- **CSRF:** SameSite=Strict + a required `X-Requested-With: creatordesk` header + `Origin` check on the cookie-authenticated endpoints (`/auth/refresh`, `/auth/logout`). In development any `http://localhost:*` origin is accepted (the Vite proxy may use any port); **in production set `CLIENT_ORIGIN` to your real site origin.**
- **Deployment constraint:** because the cookie is `SameSite=Strict`, the web app and API must be served from the same site (same registrable domain, ideally one origin behind a reverse proxy). Cross-site hosting would need a different cookie policy and stronger CSRF tokens.
- **Rate limiting & lockout:** failed register/login/change-password attempts are limited per IP; 5 wrong passwords lock the account for 15 minutes. Login errors are identical for "unknown email" and "wrong password".
- **Isolation:** every business document carries `owner`. All data access goes through `server/src/lib/scoped.js` (`scoped(Model, userId)` injects `owner`; `assertOwned` validates foreign ids). Someone else's id returns **404**, indistinguishable from a missing id. Request bodies are `.strict()`: unknown keys such as `owner` are rejected. `Category` (`/api/v1/categories`) is the reference implementation that future modules copy.

### API (all under `/api/v1`)
| Method | Path | Access |
|---|---|---|
| POST | `/auth/register`, `/auth/login` | Public, rate-limited |
| POST | `/auth/refresh`, `/auth/logout` | Refresh cookie + CSRF header |
| POST | `/auth/logout-all` | Signed in |
| GET / PATCH | `/me` | Signed in (profile: name, timezone, defaultCurrency) |
| POST | `/me/change-password` | Signed in, rate-limited |
| GET/POST, GET/PATCH/DELETE `/:id` | `/categories` | Signed in, owner-scoped |

Not built yet (deliberately): email verification, password reset, changing email (these need an email provider).

## How to verify it works
1. `npm run dev`
2. `http://localhost:5001/api/v1/health` returns `{"status":"ok",...}` (liveness, no database needed).
3. `http://localhost:5001/api/v1/health/ready` returns `200 {"database":"connected"}`. When MongoDB is down it returns `503 {"status":"degraded"}` while the API keeps running and retries in the background.
4. Open the client: you are sent to **/login**. Create an account, and you land on the dashboard. The **System status** card shows live API and database state.
5. Reload the page: you stay signed in. Open the profile menu (top right) for **Profile & settings** and **Sign out**; after signing out, any app URL redirects to /login.
6. Click through all nine sidebar items: each shows a clearly labelled **Placeholder** page with no fake data.
7. Open `/design-system` for every reusable component (buttons, forms, tables with loading/empty/error states, modal, badges).
8. Resize to phone width: the sidebar becomes a menu drawer.

## Project structure
```
server/src/
  app.js, server.js        Express app (testable) and process bootstrap
  config/                  env validation, MongoDB connection
  middleware/              error handling
  lib/                     tokens, cookies, owner-scoping helpers
  modules/<feature>/       routes, services, schemas, models (health, auth, users, categories)
  routes.js                mounts feature routers under /api/v1
client/src/
  app/                     App and routes
  components/ui/           reusable primitives
  components/layout/       AppShell, Sidebar, Topbar
  features/<feature>/      feature screens (auth, settings, dashboard, design-system)
  pages/                   placeholder and 404 pages
  lib/                     API client, health hook, navigation config
docs/PLAN.md               requirements, data model, API plan, roadmap
```

## Not implemented yet (intentionally)
Email verification / password reset, every business module (content, calendar, brands, campaigns, tasks, communications, payments), media uploads, notifications, global search, AI features. Notifications and the search entry point are labelled placeholders. Each module page shows its planned roadmap phase.

## Troubleshooting
- **Port already in use:** change `PORT` in `server/.env` and `DEV_API_TARGET` in `client/.env`. Vite automatically picks another port if 5173 is taken.
- **Dashboard says "Cannot reach the API":** the server is not running or the proxy target is wrong.
