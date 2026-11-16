# Deploying CMS to production

CMS is two parts plus two services:

| Part | What it is | Needs |
|---|---|---|
| **API** (`server/`) | Node 20+ / Express, stateless, also runs the reminder job | `MONGODB_URI`, secrets, outbound HTTPS (Cloudinary, optional AI provider) |
| **Web app** (`client/`) | Static files built by Vite (`client/dist`) | any static host; must be served on the **same site** as the API (see "Same-site rule") |
| **Database** | MongoDB 6+ (Atlas recommended) | a dedicated database user with read/write on one database |
| **File storage** | Cloudinary (private/authenticated assets) | `STORAGE_PROVIDER=cloudinary` is **mandatory** in production; the API refuses to start with local disk |

Nothing here has been run against a real hosting provider by the project author. The steps are the exact commands and settings the code requires; the host-specific screens (Render, Fly, Vercel, Netlify, Nginx...) are described generically. Follow "Verify the deployment" at the end and do not treat the deployment as working until every check passes.

## 0. Same-site rule (read this first)

The login refresh token is an `HttpOnly; SameSite=Strict` cookie scoped to `/api/v1/auth`. A browser only sends it when the web app and the API share the **same registrable domain**. So either:

- **Best:** one domain. Serve the static site at `https://app.example.com/` and reverse-proxy `https://app.example.com/api/` to the API. Set `VITE_API_BASE_URL=/api/v1`.
- **Or:** sibling subdomains, e.g. `https://app.example.com` (web) and `https://api.example.com` (API). Set `VITE_API_BASE_URL=https://api.example.com/api/v1` and `CLIENT_ORIGIN=https://app.example.com`.
- **Does not work:** web on `*.vercel.app` and API on `*.onrender.com` (different sites): the browser will never send the cookie, so every page reload logs the user out. Put both behind your own domain.

## 1. Prepare secrets

Generate and store these in your host's secret manager, never in git or in `client/.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # -> JWT_ACCESS_SECRET
```

## 2. Database (MongoDB Atlas)

1. Create a cluster (M10+ for production: backups are not available on the free/shared tiers).
2. Create a database user with the `readWrite` role on the one database only (not `atlasAdmin`).
3. Network access: allow only your API host's egress IPs (or use private networking / VPC peering). Do not leave `0.0.0.0/0` open.
4. Copy the `mongodb+srv://` string into `MONGODB_URI` (include the database name, e.g. `/cms`).
5. Turn on **continuous cloud backup** (point-in-time recovery). See [OPERATIONS.md](OPERATIONS.md).

### Indexes and schema changes

Production runs with `DB_AUTO_INDEX=false` (the default when `NODE_ENV=production`), so a restart never starts an index build under load. Instead, on **every deploy, before starting the new version**:

```bash
npm ci
npm run db:indexes -w server -- --dry-run   # lists what would be created or dropped
npm run db:indexes -w server                # applies it
```

`db:indexes` creates missing indexes and drops indexes that no longer exist in the models. Run `--dry-run` first and read the output: a `drop` line means an index the models no longer declare. Indexes with a `unique` constraint will fail to build if existing data has duplicates; the script reports the failure and exits non-zero instead of starting a broken deploy.

There is no migration framework. The data model is additive Mongoose schemas, so the safe procedure for a schema change is:

1. Make the change **backward compatible** (new fields optional or defaulted; do not rename or remove a field in the same release that stops using it).
2. Deploy and run `db:indexes`.
3. If existing documents need backfilling, write a one-off script that is idempotent, run it against a **restored copy of the backup first**, then against production during a quiet period.
4. Remove the old field in a later release.

## 3. API

Build is not needed (plain ESM). Requirements: Node 20+.

```bash
npm ci --omit=dev          # at the repository root; installs both workspaces' production dependencies
npm run db:indexes -w server
npm start                  # = node server/src/server.js
```

Production environment variables (full list with defaults in the table below and in `server/.env.example`):

```
NODE_ENV=production
PORT=5001                          # or the port your host injects
MONGODB_URI=mongodb+srv://USER:PASS@cluster.mongodb.net/cms?retryWrites=true&w=majority
JWT_ACCESS_SECRET=<48+ random chars>
CLIENT_ORIGIN=https://app.example.com
TRUST_PROXY=1                      # number of proxies in front of the API; WRONG VALUES BREAK RATE LIMITING (see below)
STORAGE_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
# optional
AI_API_KEY=...                     # AI stays off without it
LOG_LEVEL=info
```

The process **exits at startup with a list of the invalid variables** (values are never printed) if anything is missing or if production safety rules are violated: a short or placeholder `JWT_ACCESS_SECRET`, or local disk storage.

`TRUST_PROXY`: the number of reverse proxies between the internet and the API. With `0` behind a proxy, every user appears to have the proxy's IP and share one rate-limit bucket; with too high a number a client can spoof its IP with `X-Forwarded-For`. One load balancer = `1`.

Run the process under something that restarts it (the host's service manager, systemd, Docker `restart: always`). It handles `SIGTERM` gracefully (stops the reminder job, closes the HTTP server and the database connection, force-exits after 10 s).

### Running more than one instance

- Supported: sessions, data and the reminder job are database-backed and idempotent, so several instances can run.
- **Rate limits are per instance** (in-memory counters). With N instances the effective limits are up to N times higher. If that matters, put a limit at the proxy/CDN as well, or add a shared store to `express-rate-limit` (not done).
- The reminder job runs in every instance; duplicate notifications are prevented by unique keys, so this is safe but wasteful. For a larger setup, run one instance with the job and others behind it.

### Optional: Docker

No Dockerfile ships with the project. If you use containers, a minimal one is: `FROM node:20-alpine`, copy the repo, `RUN npm ci --omit=dev`, `CMD ["npm","start"]`, expose `PORT`, and pass the variables above as environment variables.

## 4. Web app

```bash
VITE_API_BASE_URL=/api/v1 npm run build -w client      # output: client/dist
```

`VITE_*` values are baked into the files at build time and are public. Never put a secret in them.

Upload `client/dist` to any static host and configure:

1. **SPA fallback:** every path that is not a file must return `index.html` with status 200 (otherwise refreshing `/campaigns` is a 404). Nginx: `try_files $uri /index.html;`. Netlify: `/* /index.html 200` in `_redirects`. Vercel: a rewrite to `/index.html`.
2. **API proxy** (same-domain layout): forward `/api/` to the API, keeping the `Host`, `X-Forwarded-For` and `X-Forwarded-Proto` headers.
3. **Caching:** `assets/*` are content-hashed, so cache them for a year; `index.html` must not be cached long.
4. **HTTPS only**, with HTTP redirecting to HTTPS. The API sends `Strict-Transport-Security`; the API cookie is `Secure` in production.
5. **Content-Security-Policy** for the static site is not set by this project (the API only sends headers for its own responses). Recommended at the static host: `default-src 'self'; img-src 'self' https://res.cloudinary.com data: blob:; media-src 'self' https://res.cloudinary.com blob:; connect-src 'self'; frame-ancestors 'none'` and tune it after checking the browser console.

## 5. File storage (Cloudinary)

1. Create a Cloudinary account and copy cloud name, API key and API secret into the API's environment.
2. Uploaded files are stored as **authenticated (private)** resources; the browser only ever gets short-lived signed links (`ASSET_TOKEN_TTL_SECONDS`, default 5 min) minted by the API after an ownership check.
3. Limits per file type, count per content item and an upload rate limit are set by the `MAX_UPLOAD_*`, `MAX_ASSETS_PER_CONTENT` and `UPLOAD_RATE_LIMIT_MAX` variables. File types are checked by their real content (magic bytes), not by the file name or the browser's claimed type.
4. Cloudinary is not backed up by this project. Enable Cloudinary's backup add-on or export periodically. See [OPERATIONS.md](OPERATIONS.md).
5. Make sure the production API is **not** run with `STORAGE_PROVIDER=local`: it will refuse to start, which is intended (container disks are ephemeral).

## 6. Environment variable reference

| Variable | Required in prod | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | yes (`production`) | `development` | Turns on production safety checks, secure cookies, hides error internals |
| `PORT` | no | `5001` | HTTP port |
| `MONGODB_URI` | **yes** | none | MongoDB connection string |
| `JWT_ACCESS_SECRET` | **yes** | none | Signs access tokens; 32+ chars, no placeholder text |
| `CLIENT_ORIGIN` | **yes** | `http://localhost:5173` | Comma-separated browser origins allowed by CORS and the CSRF origin check |
| `TRUST_PROXY` | **yes** if behind a proxy | `0` | Number of proxies in front of the API |
| `COOKIE_SECURE` | no | `true` in prod | Only change for a non-HTTPS staging environment |
| `STORAGE_PROVIDER` | **yes** (`cloudinary`) | `local` | `local` is refused in production |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | yes with cloudinary | none | Storage credentials |
| `DB_AUTO_INDEX` | no | `false` in prod, `true` elsewhere | Build indexes on startup; use `npm run db:indexes` in production |
| `LOG_LEVEL` | no | `info` (`silent` in tests) | `silent`, `error`, `warn` or `info` |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | no | `60000` / `300` | Global per-IP limit |
| `AUTH_RATE_LIMIT_WINDOW_MS` / `AUTH_RATE_LIMIT_MAX` | no | `900000` / `10` | Failed register/login/password-change attempts per IP |
| `MAX_FAILED_LOGINS` / `LOCKOUT_MINUTES` | no | `5` / `15` | Per-account lockout |
| `ACCESS_TOKEN_TTL_MINUTES` / `REFRESH_TOKEN_TTL_DAYS` | no | `15` / `30` | Session lifetimes |
| `BCRYPT_COST` | no | `12` | Password hashing cost |
| `MAX_UPLOAD_IMAGE_MB` / `_VIDEO_MB` / `_DOC_MB` | no | `10` / `100` / `20` | Upload size caps |
| `MAX_ASSETS_PER_CONTENT`, `UPLOAD_RATE_LIMIT_MAX`, `ASSET_TOKEN_TTL_SECONDS` | no | `20`, `60`, `300` | Upload and link limits |
| `CALENDAR_CONFLICT_WINDOW_MINUTES`, `REMINDER_SWEEP_SECONDS` | no | `30`, `60` | Scheduling behaviour |
| `AI_API_KEY` | no | unset = AI off | Enables the AI assistant. `AI_ENABLED`, `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, `AI_MAX_OUTPUT_TOKENS`, `AI_TIMEOUT_MS`, `AI_DAILY_REQUEST_LIMIT`, `AI_RATE_LIMIT_PER_MINUTE` are documented in the README |
| `VITE_API_BASE_URL` (build time, web app) | no | `/api/v1` | API base URL the browser calls |

## 7. Verify the deployment

Do these in order; stop at the first failure.

1. `GET https://app.example.com/api/v1/health` returns `200` `{"status":"ok"...}` (process is up).
2. `GET https://app.example.com/api/v1/health/ready` returns `200` `{"status":"ready","database":"connected"}`. A `503` means the database is unreachable.
3. Response headers include `Strict-Transport-Security`, `X-Content-Type-Options: nosniff` and an `X-Request-Id`.
4. In a browser: register a test account, reload the page (you must stay signed in: this proves the same-site cookie works), create a brand, upload an image to a content item and see the preview (proves Cloudinary and signed links), then sign out.
5. Create a task with a due time a few minutes ahead and confirm a notification arrives (proves the reminder job).
6. Call an API route 300+ times in a minute from one IP and confirm `429` (proves the proxy/`TRUST_PROXY` setting).
7. In the host's log viewer find a JSON `request` line for step 4 with your `requestId`.
8. Delete the test account's data.

## 8. Rolling back

The API is stateless and schema changes are additive, so roll back by redeploying the previous build. Do **not** run `db:indexes` from the older build after a newer one added an index you still need (it would drop it): re-run it from the version you are staying on. A data problem is handled by restoring a backup ([OPERATIONS.md](OPERATIONS.md)).
