# CMS

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
| `npm test` | Server tests (Node test runner + supertest). **Needs a local MongoDB**: uses the throw-away database `cms-test` (override with `MONGODB_URI_TEST`; the name must end in `-test`), which is wiped on every run |
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
| `CALENDAR_CONFLICT_WINDOW_MINUTES` | Same-platform posts closer than this need confirmation | `30` |
| `REMINDER_SWEEP_SECONDS` | How often the in-process reminder job runs | `60` |

**`client/.env`** (public values only; anything `VITE_*` is visible in the browser)
| Variable | Purpose | Default |
|---|---|---|
| `VITE_API_BASE_URL` | API base path/URL | `/api/v1` (uses the dev proxy) |
| `DEV_API_TARGET` | Dev-only proxy target (read by `vite.config.js`, not shipped) | `http://localhost:5001` |

The server refuses to start with an invalid environment and prints which variable is wrong (never its value).

## Authentication & data isolation
- **Passwords:** bcrypt (cost 12), 10-72 chars. Never stored, logged or returned. Responses use an allow-list serializer (`toPublicUser`).
- **Tokens:** a 15-minute access JWT kept **in browser memory only** (sent as `Authorization: Bearer`), plus an opaque refresh token in an **HttpOnly, SameSite=Strict** cookie scoped to `/api/v1/auth`, stored server-side only as a SHA-256 hash. Each refresh rotates the token; replaying an old one after a short grace window revokes the session. Logout, password change and "sign out of all devices" take effect immediately because every request also checks the session is still active.
- **CSRF:** SameSite=Strict + a required `X-Requested-With: cms` header + `Origin` check on the cookie-authenticated endpoints (`/auth/refresh`, `/auth/logout`). In development any `http://localhost:*` origin is accepted (the Vite proxy may use any port); **in production set `CLIENT_ORIGIN` to your real site origin.**
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
| GET | `/dashboard` | Signed in; read-only, always the caller's own data |
| GET / POST | `/content`, `/content/meta` | Signed in. List (search, filter, sort, paginate) and create; `meta` = workflow + limits |
| GET / PATCH / DELETE | `/content/:id` | Signed in, owner-scoped. DELETE is permanent and only for archived content |
| POST | `/content/:id/transition`, `/comments`, `/archive`, `/restore` | Controlled status moves, review comments, soft delete |
| GET | `/content/:id/history` | Change history (`?type=reviews` for comments/decisions; cursor-paginated) |
| POST / DELETE | `/content/:id/assets`, `/content/:id/assets/:assetId` | Upload (multipart, field `file`) / remove a file |
| GET | `/media/:id/access`, `/media/:id/file` | Short-lived signed link / the private file (session or signed link) |
| GET / POST | `/campaigns`, `/campaigns/meta`, `/campaigns/lookup` | List (search, stage, brand, deadline range, "needs attention", sort, pagination) and create campaigns; `lookup` is the small picker list used by the content form |
| GET / PATCH / DELETE | `/campaigns/:id` | Detail (deliverables, progress, warnings, linked content/tasks/discussions/invoices), edit, and permanent delete (archived and invoice-free only) |
| POST | `/campaigns/:id/transition`, `/archive`, `/restore` | Move along the stage workflow (guarded by deliverable states), archive/restore |
| POST / DELETE | `/campaigns/:id/content`, `/campaigns/:id/content/:contentId` | Link / unlink one of your content items |
| POST / PATCH / DELETE | `/campaigns/:id/deliverables[/:did]`, `POST .../:did/transition` | Track deliverables one by one and move each along planned → in progress → completed → awaiting approval → approved → published |
| GET / POST | `/tasks`, `/tasks/meta`, `/tasks/summary` | List (search, status, priority, due bucket, campaign, brand, content, assignee, archived, sort, pagination) and create tasks; `summary` returns overdue / due today / upcoming counts and lists |
| GET / PATCH / DELETE | `/tasks/:id` | Owner-scoped. PATCH edits (send `version` to detect stale edits); DELETE removes the task for good |
| POST | `/tasks/:id/complete`, `/reopen`, `/transition`, `/archive`, `/restore` | Mark done / reopen, move between To do, Doing, Done and Cancelled, archive and restore |
| GET | `/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` | Signed in. Entries (each linked to its content), deadlines and planned dates for a range of the user's LOCAL days (max 62). Filters: `platform`, `category`, `campaign`, `status`, `contentStatus` |
| GET | `/calendar/upcoming`, `/calendar/meta`, `/calendar/integrations` | "Needs you" panel data; stage vocabulary and limits; what each platform supports (today: manual only) |
| GET / POST | `/posts` | Signed in. List (`?content=`) and create a calendar entry |
| GET / PATCH / DELETE | `/posts/:id` | Owner-scoped. PATCH reschedules/edits (send `version` to detect stale edits) |
| POST | `/posts/:id/transition` | Controlled state changes: schedule, ready, published (user-confirmed), missed, cancelled |
| POST | `/posts/:id/publish-via-platform` | Future direct publishing. Returns **501** until a platform adapter is registered (none are) |
| GET / POST | `/notifications`, `/notifications/read-all`, `/notifications/:id/read` | In-app reminders |
| GET / POST | `/clients`, `/clients/meta` | List (search, filters, sort, pagination) and create brands/clients |
| GET / PATCH / DELETE | `/clients/:id` | Detail with derived summary; edit (needs `version`); permanent delete (archived, nothing attached) |
| POST | `/clients/:id/archive`, `/clients/:id/restore` | Archive (returns warnings for active campaigns / unpaid invoices) and restore |
| GET | `/clients/:id/campaigns`, `/clients/:id/invoices` | Read-through lists of the brand's campaigns and invoices |
| GET / POST | `/clients/:id/communications` | Saved discussions with a brand |
| GET / PATCH / DELETE | `/communications/:id` | One saved discussion |

### Content module
- **Workflow:** Idea > Planning > Creation > Review > Approved > Published. Only listed moves are allowed (`server/src/modules/content/content.constants.js` is the single source; the UI reads it from `/content/meta`). Sending to Review needs a caption or a file. **Rejecting** (Review > Creation) needs a comment, starts a new revision and withdraws any approval. **Published** means *you* confirmed it is live (time not in the future); CMS does not check the platform, and published content is locked except tags and the link.
- **History:** every creation, tracked edit (before/after for short fields; long text records only that it changed), status move, approval, rejection, comment, upload and archive is stored in an append-only history. Review comments live there too, so nothing is duplicated.
- **Media:** files are uploaded to the server, validated by their real bytes (JPEG/PNG/GIF/WebP, MP4/MOV/WebM, PDF; no SVG/HTML), size-capped per type, stored under a server-generated name, and served only through an owner check or a short-lived signed link. Choose the provider with `STORAGE_PROVIDER`: `local` (disk, development only; refused in production) or `cloudinary` (private "authenticated" assets, one folder per user). **The Cloudinary adapter is tested only against a mocked SDK in this repo; verify it with your own account before relying on it.**
- **Campaign link:** content can reference one of your campaigns (checked for ownership). A piece of content attached to a campaign deliverable cannot be moved to another campaign until it is detached.

### Calendar module (internal scheduling only)
CMS **does not publish to Instagram, YouTube, TikTok or any other network.** The calendar plans your posts and reminds you; you publish yourself and then confirm it. Four states are kept deliberately distinct, in the API and in the UI (icon + name + style, never colour alone):

| State | Stored as | Meaning |
|---|---|---|
| **Planned** | `planned` | A tentative slot. No reminder will ever fire. |
| **Scheduled reminder** | `scheduled` | CMS will remind you (in-app) before and at this time. Nothing is posted. |
| **Ready to publish** | `awaiting_confirmation` | The time has come: post it yourself, then confirm. Reached automatically by the reminder job, or by you. |
| **Published** | `published` | *You* confirmed it is live (`verification: "manual"`; time cannot be in the future; content must be approved). Only a future platform adapter can record `verification: "platform"`, and only with the platform's own post id. |

- **Time zones:** everything is stored as a UTC instant. The server interprets local wall-clock times (`scheduledLocal`, `publishedLocal`) in the user's **profile timezone** and returns each entry's local day/time, so the browser does no time-zone maths. Local times skipped by a clock change are refused; times that occur twice use the earlier one and warn. A bare date-time without an offset is rejected.
- **No accidental duplicates:** one active entry per content + platform (enforced by a unique index, so races cannot slip through); two reminders on one platform less than `CALENDAR_CONFLICT_WINDOW_MINUTES` apart need an explicit "schedule anyway".
- **Conflicting updates:** every entry has a `version`; an edit or drag made from a stale screen is refused (409) instead of silently overwriting. The reminder job bumps the version when it changes a state.
- **Reminders:** per-entry lead times plus defaults in Settings; deadline reminders use the end of the deadline day in the user's timezone. An in-process job (`REMINDER_SWEEP_SECONDS`) delivers **in-app notifications only** (the bell). Every notification has a unique key, so sweeps are idempotent, safe on several servers, and rescheduling re-arms them.
- **Views:** month, week, day (and a phone-friendly agenda), filters by platform, category, campaign, entry state and content status, drag-and-drop rescheduling on desktop pointers (touch screens use the edit dialog), and every entry links to its content (and back from the content page).
- **Future publishing:** `server/src/integrations/publishing/` defines the adapter contract (`adapter.js`), a registry that is **empty by design**, and the only code path allowed to mark a post platform-published (`publishing.service.js`). To add a network, implement and test the adapter against the platform's real, authorised API and register it there; nothing else changes.

### Campaigns
Sidebar **Campaigns**. A campaign belongs to one of your brands and holds the brief, objectives, budget, agreed fee (integer minor units + currency), start/end dates, a hand-over **deadline**, the requested platforms/formats/quantities, and the review rules (does the brand approve work before it is published, and who). Everything is owner-scoped: a brand, content item or deliverable of another account is refused exactly like a missing one.
- **Progress is computed, never typed in.** Each deliverable is tracked on its own through *planned → in progress → completed → awaiting approval → approved → published* (work that needs no approval skips straight from completed to published; "changes requested" sends it back and counts a revision). Campaign progress is the average of fixed per-state weights (0 / 20 / 50 / 65 / 85 / 100, see `DELIVERABLE_WEIGHTS`), and the page also shows how many are planned, completed, approved and published. A deliverable linked to content cannot be marked published before that content is.
- **Warnings are derived on every request** (`campaign.progress.js`): deadline within 7 days / today / passed, deliverables overdue or due soon, deliverables due after the campaign deadline, unfinished deliverables near the deadline or when the campaign is already marked delivered, requested pieces that have no deliverable yet, and an end date that passed without the campaign being delivered. Completed, cancelled and archived campaigns raise none. "Today" is the user's own calendar day.
- **Status changes** follow a fixed workflow (proposed → negotiating → confirmed → in progress → delivered → completed, plus cancelled and re-open) and every change is recorded with its time and optional note. A campaign cannot be marked *delivered* while deliverables are still planned or in progress, nor *completed* until all are published.
- **Archive, then delete.** Archived campaigns are hidden and read-only; permanent delete needs the campaign archived first and is refused while invoices point at it. Linked content, tasks and discussions are kept and only lose the pointer.
- Dates are calendar days stored as local midnight in the user's timezone. Campaign deadlines also raise an in-app reminder (the bell) using your deadline lead times, until the campaign is delivered, archived or closed.

### Tasks
Sidebar **Tasks**, with a **List** and a **Board** (To do / Doing / Done, drag a card or use its status menu). A task has a title, notes, priority (low / normal / high / urgent), status, an optional due date with an optional time, optional in-app reminders, and an optional link to a campaign, brand and/or content item. Everything is owner-scoped; a campaign, brand or content item of another account is refused exactly like a missing one (400 for body references, 404 for URL ids).
- **Links agree with each other.** Choosing a campaign fills in its brand; choosing content that belongs to a campaign fills in that campaign. A brand that does not match the campaign, or content from a different campaign, is refused. Archived records cannot receive new tasks, but existing links survive archiving. Deleting a campaign, brand or content item keeps the task and clears the link.
- **Due dates and time zones.** A date alone means the task is due for the whole day in your profile timezone and is overdue from the start of the next day. A date with a time is an exact moment and is overdue once it passes. A time skipped by a clock change is refused; a time that happens twice uses the earlier one. One definition (`task.logic.js`) drives the list filters, the summary, the dashboard and the reminders, so a task is in exactly one of overdue / due today / upcoming everywhere. Done, cancelled and archived tasks are never overdue.
- **Brand and content pages** have a Tasks tab (open tasks, one-click complete, "Add task" pre-linked); the campaign page has the same list.
- **Assignee** exists for future team support; today it can only be you (or empty).
- **Reminders** are sent by the server's reminder job (`REMINDER_SWEEP_SECONDS`), not by the browser, so they arrive with the page closed. Each task has its own lead times (new tasks use your deadline lead times from Settings); date-only tasks count back from the END of the due day. One notification is sent per task, lead time and due moment, plus one "overdue" notice when it turns late. Sweeps are idempotent and safe on several servers, rescheduling re-arms the reminders, and finished, cancelled or archived tasks send nothing. Reminders are in-app only.

### Brands & clients (CRM)
Sidebar **Brands**. Each record holds contact people (exactly one primary), website and social links, industry and category, contact preferences, collaboration notes, negotiated reference rates (integer minor units + currency), payment terms, exclusivity/usage terms, and a follow-up date. Everything is owner-scoped; another user's id returns 404.
- **Nothing is duplicated.** Campaigns, invoices and payments are never copied onto the brand. The detail page reads them through references (`client` on campaigns and invoices), and `lastContact`, discussion counts, active-campaign counts and agreed/invoiced/collected/outstanding figures are **derived** on every request. The money rules are shared with the dashboard (`invoice.aggregates.js`), so both screens always agree. Totals are per currency, never summed across currencies.
- **Until Payments exists** that tab says "Not available yet" rather than showing a made-up zero (module flags in `server/src/config/modules.js`).
- **Saved discussions** are notes you write about a conversation (email, call, meeting, DM...). CMS does not send or receive messages. Times are entered in your profile timezone and cannot be in the future; a discussion may only link a campaign and a contact belonging to the same brand.
- **Archive, then delete.** Archiving hides a brand but keeps its history, and warns if campaigns are active or invoices unpaid. Permanent delete needs the brand archived first and is refused while campaigns or invoices still point at it. Names are unique per user among non-archived brands (case-insensitive).
- **Follow-ups:** the reminder job creates one in-app notification ("Follow up with ...") at the start of the follow-up day in your timezone (`followUpReminders` in the sweep stats). No email is sent.
- **Concurrency:** edits send the brand's `version`; a stale edit is refused (409) instead of overwriting.
- Search is a literal, escaped text match across name, contacts, email, industry, category and notes; it is never evaluated as a regular expression.

### Dashboard
`GET /api/v1/dashboard` returns seven independent sections (content pipeline, upcoming posts, campaigns & deadlines, tasks, pending reviews, payments, recent activity) plus a `definitions` block stating, for every metric, whether it is a **count**, an **amount** (integer minor units, per currency, never summed across currencies) or a **duration**, and the **time period** it covers. "Today" and "this month" use the user's profile timezone. Each section is `ok`, `unavailable` or `error`:
- `unavailable`: the module that owns the data has no features yet (`server/src/config/modules.js`). The UI says so instead of showing a made-up zero. **Flip the flag to `ready: true` in the same change that ships that module.**
- `error`: that one section failed; the others still render.
The tasks section shows overdue, due today and upcoming (next 7 days) with exact counts. Payments is the only module still marked unavailable until its endpoints ship.

Not built yet (deliberately): direct publishing to any social network, email/push reminders, email verification, password reset, changing email (these need an email provider).

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
Email verification / password reset, the tasks and payments modules, a full communications inbox (saved discussions are managed from each brand), global search and AI features. The search entry point and the unbuilt module pages are labelled placeholders showing their planned roadmap phase.

## Troubleshooting
- **Port already in use:** change `PORT` in `server/.env` and `DEV_API_TARGET` in `client/.env`. Vite automatically picks another port if 5173 is taken.
- **Dashboard says "Cannot reach the API":** the server is not running or the proxy target is wrong.
