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
```
Edit `server/.env` if your MongoDB is not at the default address. `.env` files are git-ignored; never commit real credentials.

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
| `npm test` | Server tests (Node test runner + supertest; no database needed) |
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
| `MONGODB_URI` | MongoDB connection string (**required**) | — |
| `DB_RETRY_SECONDS` | Delay between reconnect attempts | `5` |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | Global rate limit | `60000`, `300` |

**`client/.env`** (public values only; anything `VITE_*` is visible in the browser)
| Variable | Purpose | Default |
|---|---|---|
| `VITE_API_BASE_URL` | API base path/URL | `/api/v1` (uses the dev proxy) |
| `DEV_API_TARGET` | Dev-only proxy target (read by `vite.config.js`, not shipped) | `http://localhost:5001` |

The server refuses to start with an invalid environment and prints which variable is wrong (never its value).

## How to verify it works
1. `npm run dev`
2. `http://localhost:5001/api/v1/health` returns `{"status":"ok",...}` (liveness, no database needed).
3. `http://localhost:5001/api/v1/health/ready` returns `200 {"database":"connected"}`. When MongoDB is down it returns `503 {"status":"degraded"}` while the API keeps running and retries in the background.
4. Open the client. The Dashboard **System status** card shows live API and database state; stop MongoDB and press Refresh to see it turn red.
5. Click through all nine sidebar items: each shows a clearly labelled **Placeholder** page with no fake data.
6. Open `/design-system` for every reusable component (buttons, forms, tables with loading/empty/error states, modal, badges).
7. Resize to phone width: the sidebar becomes a menu drawer.

## Project structure
```
server/src/
  app.js, server.js        Express app (testable) and process bootstrap
  config/                  env validation, MongoDB connection
  middleware/              error handling
  modules/<feature>/       routes, controllers, services, models per feature (health only so far)
  routes.js                mounts feature routers under /api/v1
client/src/
  app/                     App and routes
  components/ui/           reusable primitives
  components/layout/       AppShell, Sidebar, Topbar
  features/<feature>/      feature screens (dashboard, design-system)
  pages/                   placeholder and 404 pages
  lib/                     API client, health hook, navigation config
docs/PLAN.md               requirements, data model, API plan, roadmap
```

## Not implemented yet (intentionally)
Authentication and user accounts, every business module (content, calendar, brands, campaigns, tasks, communications, payments), media uploads, notifications, global search, AI features. The profile menu, notifications and search entry point are labelled placeholders. Each module page shows its planned roadmap phase.

## Troubleshooting
- **Port already in use:** change `PORT` in `server/.env` and `DEV_API_TARGET` in `client/.env`. Vite automatically picks another port if 5173 is taken.
- **Dashboard says "Cannot reach the API":** the server is not running or the proxy target is wrong.
