# CreatorDesk — Planning Document (Phase 0)

Status: DRAFT for approval. No application code exists yet. Repo was empty at time of writing, so nothing is reused.

---

## 0. Architecture in plain language

Think of the app as three layers:

1. **Browser app (React)** — what the influencer sees. It never holds secrets. It only talks to our own server.
2. **Server (Express)** — the only thing allowed to touch the database, Cloudinary, AI providers and social platforms. It checks *who you are* (authentication) and *what you may touch* (authorization) on every request.
3. **Database (MongoDB)** — stores everything. Every record carries an `owner` field (the user's id). The server adds `owner = you` to every query, so you can never read someone else's rows.

Inside the server, code is split so each job has one home:

- **routes** — URL → function mapping, nothing else
- **controllers** — read the request, call a service, send the response
- **services** — business rules ("an invoice can't be paid beyond its total")
- **models** — Mongoose schemas
- **integrations** — adapters for Cloudinary, AI, Instagram/YouTube, email. Services call an *interface*, never a vendor directly, so adding a vendor later means adding one file.

### Key design decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | **Owner-scoped everything**: every business document has `owner: ObjectId(User)`; all data access goes through a helper that injects `owner` | Makes isolation the default, not something each developer must remember |
| D2 | **Foreign-key ownership check**: when a request references another document (e.g. `campaign` on a task), the service verifies that referenced doc has the same owner | Otherwise user B could attach A's client id to B's invoice and leak data |
| D3 | **"Not yours" returns 404, not 403** | Doesn't reveal that the id exists |
| D4 | **Access token (15 min, in memory) + refresh token (httpOnly cookie, rotated, stored hashed in DB)** | No JWT in localStorage (XSS-stealable); sessions can be revoked |
| D5 | **Content ≠ Post.** `Content` is the idea/asset (script, media, caption draft). `Post` is one planned/real publication of it on one platform | One reel can go to Instagram + YouTube Shorts with different times/captions; maps cleanly to future platform APIs |
| D6 | **Honest publishing state** (see §2.2). "Scheduled" is internal intent only. `published` requires either user confirmation (`verification: "manual"`) or platform confirmation (`verification: "platform"` + external post id) | Hard requirement: never claim publication that didn't happen |
| D7 | **Money = integer minor units + ISO currency code** (₹100.50 → `10050`, `"INR"`) | Avoids floating-point errors |
| D8 | **Outstanding balance is computed, not stored.** `balance = invoice.total − Σ payments`. Invoice status "overdue" is derived from `dueDate` | One source of truth, can't drift |
| D9 | **Denormalization only where legally/historically required**: issued invoices snapshot the client's billing details & line items (a bill must not change if the client is later edited). Nowhere else | Matches "avoid duplication" rule with one documented exception |
| D10 | **Soft delete (`archivedAt`) for business records**, hard delete only for account deletion | Protects payment/communication history |
| D11 | **Timestamps on all collections** via Mongoose `timestamps: true`; all dates stored UTC, user timezone on `User.timezone` | Calendars across timezones |
| D12 | **Background jobs via a small job runner** (reminders, scheduled-post nudges, overdue sweep) using atomic "claim" updates so multiple server instances don't double-fire | Starts simple (in-process), scales later |
| D13 | **AI as a service behind an interface** with per-user usage logging; AI only *suggests*, user confirms any write | Safe + swappable provider |
| D14 | **API versioned `/api/v1`**, uniform error shape, validation with a schema library (Zod) on every endpoint | Predictable client, safe input |

---

## 1. Functional Requirements

Notation: **FR-<module>-n**. MUST = needed for MVP; SHOULD = after MVP; LATER = future phase.

### 1.1 Accounts & Security (AUTH)
- FR-AUTH-1 MUST register with email + password (min 10 chars, breached/weak-list check optional), name, timezone.
- FR-AUTH-2 MUST login, logout, logout-all-devices; refresh sessions silently.
- FR-AUTH-3 MUST hash passwords (argon2id preferred, bcrypt cost ≥12 acceptable).
- FR-AUTH-4 MUST email verification & password reset via single-use, expiring, hashed tokens.
- FR-AUTH-5 MUST rate-limit login/register/reset; lock/slow after repeated failures.
- FR-AUTH-6 MUST profile update, change password (revokes other sessions), delete account (deletes all owned data + Cloudinary assets).
- FR-AUTH-7 SHOULD export my data (JSON).

### 1.2 Content management (CONTENT)
- FR-CONTENT-1 MUST create/edit/archive content items: title, type (reel, short, video, story, carousel, post, blog, podcast, other), description/script, caption, hashtags, status, category, tags, media.
- FR-CONTENT-2 MUST user-defined categories (name, color) and free tags; filter/search/sort by status, category, tag, text, date.
- FR-CONTENT-3 MUST upload media to Cloudinary through **signed uploads** (server issues a signature; browser uploads directly; no secret in browser). Store only `publicId`, `url`, metadata.
- FR-CONTENT-4 MUST content pipeline statuses: `idea → drafting → ready → (posts handle scheduling/publishing) → archived`.
- FR-CONTENT-5 SHOULD duplicate content; bulk status/category change.
- FR-CONTENT-6 SHOULD link content to a campaign deliverable (content ↔ campaign via `Deliverable`).

### 1.3 Calendar & publishing workflow (CAL)
- FR-CAL-1 MUST create a `Post` for a content item: platform, scheduledAt, platform-specific caption override, status.
- FR-CAL-2 MUST month/week/agenda calendar showing posts, task due dates, campaign deadlines, invoice due dates (read-only overlays toggleable).
- FR-CAL-3 MUST drag-to-reschedule; conflict warning when two posts same platform within a configurable window.
- FR-CAL-4 MUST honest status model (§2.2). UI wording: "Scheduled (internal reminder)" until verified.
- FR-CAL-5 MUST at scheduled time create an in-app notification "Time to post X" with a "Mark as published" action requiring the user to confirm (optionally paste the post URL).
- FR-CAL-6 MUST if user does not act, post becomes `needs_attention` (a "missed" state), never auto-"published".
- FR-CAL-7 LATER auto-publish through platform APIs; result is only `published` after the platform returns a post id (stored in `externalPostId`, `verification: "platform"`); API errors → `failed` with reason.

### 1.4 Brand & client CRM (CRM)
- FR-CRM-1 MUST clients (brand/agency): name, type, website, industry, status (lead, active, past, blocked), notes, billing details, default currency, payment terms, multiple contacts (name, role, email, phone, isPrimary).
- FR-CRM-2 MUST client detail page aggregating: campaigns, communications, invoices, outstanding balance (queried via references, not copied).
- FR-CRM-3 MUST search/filter/archive; prevent duplicate client names per owner (case-insensitive).
- FR-CRM-4 SHOULD follow-up date per client ("contact again on").
- FR-CRM-5 SHOULD lead pipeline board (lead → negotiating → active).

### 1.5 Campaign management (CAMP)
- FR-CAMP-1 MUST campaigns: client (required), title, brief, status (`proposed, negotiating, confirmed, in_progress, delivered, completed, cancelled`), start/end dates, agreed fee (minor units + currency), usage-rights notes, exclusivity notes, promo code/UTM, attachments.
- FR-CAMP-2 MUST deliverables per campaign: description, platform, type, quantity, due date, status, approval required flag, linked Content/Post.
- FR-CAMP-3 MUST campaign detail aggregating deliverables, tasks, communications, invoices, paid vs outstanding.
- FR-CAMP-4 SHOULD approval workflow status on deliverables (`draft_sent, changes_requested, approved`).
- FR-CAMP-5 SHOULD performance notes (manual metrics now; platform metrics LATER).

### 1.6 Tasks, deadlines, reminders (TASK)
- FR-TASK-1 MUST tasks: title, description, due date, priority, status (`todo, doing, done, cancelled`), optional links to campaign / client / content / deliverable.
- FR-TASK-2 MUST reminders: one or more `remindAt` per task (or per post/invoice); in-app notifications; email SHOULD.
- FR-TASK-3 MUST views: today, upcoming, overdue, by campaign; mark complete (stores `completedAt`).
- FR-TASK-4 SHOULD recurring tasks, subtasks checklist.
- FR-TASK-5 MUST overdue detection computed at read time (no stale flag).

### 1.7 Communication records (COMM)
- FR-COMM-1 MUST log entries: client (required), optional campaign, channel (email, call, meeting, DM, whatsapp, other), direction (inbound/outbound), occurredAt, subject, summary/body, attachments, optional contact.
- FR-COMM-2 MUST chronological timeline per client and per campaign; full-text search.
- FR-COMM-3 MUST optional follow-up: creating a follow-up creates a linked `Task` (reference, no duplication).
- FR-COMM-4 SHOULD edit history is not required, but entries are never silently deleted (archive).
- FR-COMM-5 LATER Gmail/IMAP import. Records are **manual logs**; the app never claims it sent a message.

### 1.8 Payments, invoices, balances (PAY)
- FR-PAY-1 MUST invoices: client (required), optional campaign, number (unique per owner, sequential, configurable prefix), issueDate, dueDate, currency, line items, tax, discount, notes, status (`draft, sent, void`). `sent` is user-declared ("I sent it") — we don't email unless an email integration is later enabled.
- FR-PAY-2 MUST payments recorded against an invoice: amount, date, method, reference, notes. Multiple partial payments allowed. Overpayment rejected.
- FR-PAY-3 MUST derived invoice display status: `draft | sent | partially_paid | paid | overdue | void`.
- FR-PAY-4 MUST outstanding balance totals per invoice, client, campaign, and overall, **per currency** (never sum across currencies).
- FR-PAY-5 MUST issued invoice is immutable except notes/status→void; corrections via void + new invoice.
- FR-PAY-6 SHOULD PDF invoice generation. SHOULD payment-received without invoice (advance) → LATER.
- FR-PAY-7 SHOULD overdue reminders to the influencer ("Brand X is 7 days late").

### 1.9 Dashboard & search (DASH)
- FR-DASH-1 MUST today's posts, due tasks, overdue items, outstanding balance by currency, active campaigns, recent communications.
- FR-DASH-2 SHOULD global search across content/clients/campaigns.

### 1.10 AI assistance (AI) — later phase
- FR-AI-1 Caption/hashtag/ideas suggestions; campaign brief summarizer; communication summarizer; draft reply/follow-up; invoice-reminder wording; weekly plan suggestion.
- FR-AI-2 AI output is a *suggestion*; nothing is saved/sent without user action.
- FR-AI-3 Only the minimum necessary data goes to the LLM; per-user rate/usage limits; usage log; user can disable AI.

### 1.11 Non-functional requirements
- Security: OWASP ASVS L1 baseline; Helmet; strict CORS; input validation; NoSQL-injection sanitization; secrets only in server env; dependency audit in CI.
- Privacy: user can export/delete data; no PII in logs.
- Performance: list endpoints paginated (default 20, max 100); indexes for every filter.
- Reliability: structured logging with request id; health endpoint; graceful shutdown.
- Accessibility & responsive: mobile-friendly (influencers use phones).
- Maintainability: lint + format + tests required in CI; ≥80% coverage on services.

---

## 2. User journeys & edge cases

### 2.1 Journeys
1. **Onboarding**: register → verify email → set timezone/currency defaults → empty-state prompts ("add your first client / content idea").
2. **Idea to published**: add idea → draft + upload media → mark ready → create Post for Instagram at Fri 6pm → Friday reminder → user posts manually → clicks "Mark published", pastes URL → status `published (confirmed by you)`.
3. **New brand deal**: create client → create campaign (proposed) → log call → add deliverables → status confirmed → tasks auto-added by user → link content to deliverables → mark delivered → create invoice → record partial payment → outstanding shown.
4. **Chasing a payment**: dashboard shows overdue invoice → open client → timeline → log "emailed reminder" → follow-up task created for 3 days later.
5. **Weekly planning**: calendar week view → drag posts → see overlay of deadlines → resolve conflicts.

### 2.2 Post status model (honesty rule)
```
planned ──► scheduled ──► awaiting_confirmation ──► published
   │            │                  │                    ▲
   │            │                  └──► missed          │ (verification: manual | platform)
   │            └──► cancelled      └──► failed (API only)
```
- `scheduled` = "app will remind me", **not** "platform will post".
- Transition to `published` only via (a) explicit user action, storing `publishedAt`, `verification:"manual"`, optional `externalUrl`; or (b) a platform adapter returning an external id, `verification:"platform"`.
- UI labels and API field `verification` always expose the source.

### 2.3 Edge cases (non-exhaustive)
**Auth/isolation**: expired access token mid-request → silent refresh once; reused (stolen) refresh token → revoke whole token family; user B requests user A's id → 404; B sends A's client id in B's invoice → 404 validation error; mass-assignment (`owner`, `_id`, `role` in body) ignored; deleted user's active token → rejected (tokenVersion check).
**Content**: Cloudinary upload succeeded but save failed → orphan cleanup job; huge/unsupported file type → rejected by server-issued upload preset constraints; deleting a category in use → reassign or null, not cascade-delete content; content with posts being archived → posts remain, warned.
**Calendar**: DST changes; past `scheduledAt` → allowed only as "backfill" with explicit flag; editing a post after it's `published` → only notes/URL editable; same content on two platforms.
**CRM/Campaign**: duplicate client name; archiving client with open campaigns/unpaid invoices → blocked or warned; campaign date end < start → rejected; deliverable due after campaign end → warning; campaign cancelled with unpaid invoices → invoices untouched.
**Tasks**: due date in past on create; timezone of "due today"; reminder in the past → fire immediately once; completing task twice idempotent; linked entity archived.
**Comms**: backdated entries; entry without a campaign; client deleted → blocked (archive only).
**Payments**: partial/over/zero/negative payment; payment date before invoice date → warn; payment deleted → balance recomputes; invoice void with payments → block until payments reversed; currency mismatch payment vs invoice → rejected; invoice number race → atomic counter (`findOneAndUpdate $inc`); rounding on tax per line vs total (decide once: compute per-line, round half-up to minor unit); multi-currency totals shown separately.
**Jobs**: server restarts → missed reminders are caught up on boot; two instances → atomic claim; reminder spam guard.
**AI (later)**: provider timeout → graceful message; prompt-injection in pasted brand emails → AI output never executes actions; token cost caps.

---

## 3. Database design (MongoDB / Mongoose)

Conventions: every collection has `createdAt`, `updatedAt` (Mongoose timestamps). Owner-scoped collections have `owner` (indexed first in every compound index). `archivedAt: Date|null` where "soft delete" applies. Money = `{ amount: Int, currency: "INR" }` stored as `amountMinor` + `currency`.

### 3.1 Relationship overview
```
User 1─* Category, Content, Client, Campaign, Task, Communication, Invoice, Payment, Notification, MediaAsset, SocialAccount
Client 1─* Contact(embedded) ; Client 1─* Campaign ; Client 1─* Communication ; Client 1─* Invoice
Campaign 1─* Deliverable ; Campaign 1─* Task ; Campaign 1─* Communication ; Campaign 1─* Invoice
Content *─1 Category ; Content *─* MediaAsset ; Content 1─* Post
Deliverable *─1 Content (optional) ; Deliverable *─1 Post (optional)
Invoice 1─* Payment ; Invoice 1─* LineItem(embedded)
Task *─1 (Campaign | Client | Content | Deliverable | Invoice)  (all optional)
Communication 1─0..1 Task (follow-up)
Post *─1 SocialAccount (optional, future)
```

### 3.2 Collections

**User**
`email` (unique, lowercase), `passwordHash`, `name`, `avatar`(MediaAsset ref, optional), `timezone`, `defaultCurrency`, `emailVerifiedAt`, `tokenVersion`, `failedLoginCount`, `lockedUntil`, `settings{ invoicePrefix, nextInvoiceNumber, aiEnabled, reminderDefaults }`, `lastLoginAt`.
Never returned: `passwordHash`, `tokenVersion`.

**Session** (refresh tokens) — `user`, `tokenHash`, `family`, `expiresAt` (TTL index), `revokedAt`, `userAgent`, `ip`, `replacedBy`.

**VerificationToken** — `user`, `type` (email_verify|password_reset), `tokenHash`, `expiresAt` (TTL), `usedAt`.

**Category** — `owner`, `name`, `color`, `kind`("content"). Unique `{owner, nameLower}`.

**MediaAsset** — `owner`, `provider`("cloudinary"), `publicId`, `url`, `resourceType`, `format`, `bytes`, `width`, `height`, `duration`, `originalName`, `usage`(content|attachment|avatar). Index `{owner, createdAt}`. Content/Communication/Campaign refer to assets by id (no URL copies).

**Content** — `owner`, `title`, `type`, `status`(idea|drafting|ready|archived), `category`→Category, `tags[String]` (normalized lowercase), `script`, `caption`, `hashtags[]`, `notes`, `mediaAssets[]`→MediaAsset, `archivedAt`.
Indexes: `{owner,status,updatedAt}`, `{owner,category}`, `{owner,tags}`, text index on title/caption/script.

**Post** — `owner`, `content`→Content, `platform`(instagram|youtube|tiktok|x|linkedin|facebook|blog|other), `socialAccount`→SocialAccount?, `captionOverride`, `scheduledAt`, `status`(planned|scheduled|awaiting_confirmation|published|missed|failed|cancelled), `publishedAt`, `verification`(none|manual|platform), `externalPostId`, `externalUrl`, `failureReason`, `reminderSentAt`, `claimedAt`, `deliverable`→Deliverable?.
Indexes: `{owner,scheduledAt}`, `{status,scheduledAt}` (job sweep), `{owner,content}`.
Invariant: `status="published"` ⇒ `verification ∈ {manual, platform}`; `platform` ⇒ `externalPostId` present. Enforced in service + schema validator.

**SocialAccount** *(schema reserved, used in integration phase)* — `owner`, `platform`, `handle`, `externalAccountId`, `encryptedAccessToken`, `encryptedRefreshToken`, `tokenExpiresAt`, `scopes[]`, `status`, `connectedAt`. Tokens encrypted at rest with server key (AES-256-GCM); never sent to client.

**Client** — `owner`, `name`, `nameLower`, `type`(brand|agency|individual|other), `status`(lead|active|past|blocked), `website`, `industry`, `contacts[{_id,name,role,email,phone,isPrimary}]`, `billing{legalName,address,taxId,email}`, `defaultCurrency`, `paymentTermsDays`, `followUpAt`, `notes`, `archivedAt`.
Unique `{owner,nameLower}` (partial: non-archived). Index `{owner,status}`.

**Campaign** — `owner`, `client`→Client, `title`, `brief`, `status`, `startDate`, `endDate`, `fee{amountMinor,currency}`, `usageRights`, `exclusivity`, `promoCode`, `attachments[]`→MediaAsset, `notes`, `archivedAt`.
Index `{owner,client}`, `{owner,status,endDate}`.

**Deliverable** — `owner`, `campaign`→Campaign, `title`, `platform`, `type`, `quantity`, `dueDate`, `status`(pending|in_progress|submitted|changes_requested|approved|delivered), `requiresApproval`, `content`→Content?, `post`→Post?. Index `{owner,campaign}`, `{owner,dueDate}`.

**Task** — `owner`, `title`, `description`, `dueAt`, `priority`(low|normal|high), `status`(todo|doing|done|cancelled), `completedAt`, `reminders[{remindAt, sentAt}]`, `links{campaign,client,content,deliverable,invoice,communication}` (each optional ObjectId), `recurrence?`, `checklist[{text,done}]`, `archivedAt`.
Indexes: `{owner,status,dueAt}`, `{owner,'links.campaign'}`, `{'reminders.remindAt','reminders.sentAt'}` for job.

**Communication** — `owner`, `client`→Client, `campaign`→Campaign?, `contactId` (embedded contact _id)?, `channel`, `direction`, `occurredAt`, `subject`, `body`, `attachments[]`→MediaAsset, `followUpTask`→Task?, `archivedAt`. Text index body/subject. Index `{owner,client,occurredAt:-1}`, `{owner,campaign,occurredAt:-1}`.

**Invoice** — `owner`, `client`→Client, `campaign`→Campaign?, `number` (unique `{owner,number}`), `status`(draft|sent|void), `issueDate`, `dueDate`, `currency`, `lineItems[{description,quantity,unitAmountMinor,taxRatePct}]`, `discountMinor`, `notes`, `billingSnapshot{...}` (frozen at `sent`), `subtotalMinor`, `taxMinor`, `totalMinor` (computed & frozen at `sent`; recomputed in drafts), `sentAt`, `voidedAt`, `voidReason`.
Index `{owner,client,status}`, `{owner,dueDate,status}`.

**Payment** — `owner`, `invoice`→Invoice, `amountMinor`, `currency` (must equal invoice's), `paidAt`, `method`, `reference`, `notes`. Index `{owner,invoice}`, `{owner,paidAt}`.
Derived (aggregation, never stored): `paidMinor`, `balanceMinor`, display status.

**Notification** — `owner`, `type`, `title`, `body`, `entity{kind,id}`, `readAt`, `dedupeKey` (unique per owner to prevent duplicate reminders). TTL after 90 days.

**AiInteraction** *(AI phase)* — `owner`, `feature`, `model`, `inputTokens`, `outputTokens`, `status`, `createdAt`. Stores metadata only by default, not prompts.

**Counter** — handled by `User.settings.nextInvoiceNumber` with atomic `$inc`.

### 3.3 Integrity strategy
- Reference-ownership validation in a shared `assertOwned(model, ids, owner)` helper.
- Delete rules: archive instead of delete; "delete" endpoints for client/campaign/invoice return 409 if dependents exist.
- Multi-document consistency (e.g. create communication + follow-up task) uses transactions (requires replica set → MongoDB Atlas or local replica set).

---

## 4. API plan

Base: `/api/v1`. JSON. Errors: `{ error: { code, message, details? } }`.
Pagination: `?page=&limit=&sort=&q=` → `{ data, meta:{page,limit,total} }`.
Access legend: **Public** = no auth · **Auth** = valid access token, data auto-scoped to caller (`owner`). No admin role in MVP.

### Auth & account
| Method | Path | Access |
|---|---|---|
| POST | /auth/register | Public (rate-limited) |
| POST | /auth/login | Public (rate-limited) |
| POST | /auth/refresh | Public (needs refresh cookie) |
| POST | /auth/logout | Auth |
| POST | /auth/logout-all | Auth |
| POST | /auth/verify-email | Public (token) |
| POST | /auth/resend-verification | Auth |
| POST | /auth/forgot-password | Public (rate-limited, no user enumeration) |
| POST | /auth/reset-password | Public (token) |
| GET/PATCH | /me | Auth |
| POST | /me/change-password | Auth |
| GET | /me/export | Auth |
| DELETE | /me | Auth (re-enter password) |
| GET | /health | Public |

### Media
| POST | /media/signature | Auth — returns Cloudinary signed params |
| POST | /media | Auth — register uploaded asset (verify `publicId` folder prefix = owner) |
| GET | /media, GET /media/:id | Auth |
| DELETE | /media/:id | Auth (blocked if referenced) |

### Content & categories
| GET/POST | /categories | Auth |
| PATCH/DELETE | /categories/:id | Auth |
| GET/POST | /content | Auth |
| GET/PATCH | /content/:id | Auth |
| POST | /content/:id/archive, /restore, /duplicate | Auth |
| GET | /content/:id/posts | Auth |

### Calendar / posts
| GET/POST | /posts | Auth (`?from&to&platform&status`) |
| GET/PATCH | /posts/:id | Auth |
| POST | /posts/:id/schedule | Auth |
| POST | /posts/:id/cancel | Auth |
| POST | /posts/:id/mark-published | Auth — body `{publishedAt, externalUrl?}`; sets `verification:"manual"` |
| GET | /calendar?from&to&include=posts,tasks,deliverables,invoices | Auth |
| GET/POST/DELETE | /social-accounts… | Auth — *reserved, 501 until integration phase* |

### CRM
| GET/POST | /clients | Auth |
| GET/PATCH | /clients/:id | Auth |
| POST | /clients/:id/archive, /restore | Auth |
| POST/PATCH/DELETE | /clients/:id/contacts[/:contactId] | Auth |
| GET | /clients/:id/summary | Auth — campaigns count, outstanding by currency, last contact |
| GET | /clients/:id/communications, /campaigns, /invoices | Auth |

### Campaigns
| GET/POST | /campaigns | Auth |
| GET/PATCH | /campaigns/:id | Auth |
| POST | /campaigns/:id/archive, /restore | Auth |
| GET/POST | /campaigns/:id/deliverables | Auth |
| PATCH/DELETE | /deliverables/:id | Auth |
| GET | /campaigns/:id/summary | Auth — deliverable progress, fee, invoiced, paid, outstanding |

### Tasks & notifications
| GET/POST | /tasks | Auth (`?status&due=today|overdue|upcoming&campaign&client`) |
| GET/PATCH/DELETE | /tasks/:id | Auth |
| POST | /tasks/:id/complete, /reopen | Auth |
| GET | /notifications | Auth |
| POST | /notifications/:id/read, /read-all | Auth |

### Communications
| GET/POST | /communications | Auth (`?client&campaign&channel&from&to&q`) |
| GET/PATCH | /communications/:id | Auth |
| POST | /communications/:id/archive | Auth |
| POST | /communications/:id/follow-up | Auth — creates linked Task |

### Invoices & payments
| GET/POST | /invoices | Auth |
| GET/PATCH | /invoices/:id | Auth (PATCH limited by status) |
| POST | /invoices/:id/mark-sent, /void | Auth |
| GET | /invoices/:id/pdf | Auth (later) |
| GET/POST | /invoices/:id/payments | Auth |
| PATCH/DELETE | /payments/:id | Auth |
| GET | /payments | Auth |
| GET | /finance/summary | Auth — outstanding/overdue/received by currency & period |

### Dashboard / search
| GET | /dashboard | Auth |
| GET | /search?q= | Auth |

### AI (later)
| POST | /ai/suggest-caption, /ai/summarize-communication, /ai/draft-followup, /ai/weekly-plan | Auth, rate-limited, feature-flagged |

### Cross-cutting middleware order
`requestId → helmet → cors(allow-list) → rateLimit → json(limit 1MB) → sanitize → auth → validate(Zod) → controller → errorHandler`

---

## 5. Frontend plan (React + Vite + Tailwind)

**Libraries (proposed):** React Router, TanStack Query (server state), React Hook Form + Zod, Axios (interceptor for refresh), a calendar lib (FullCalendar or custom), date-fns / Luxon, Headless UI/Radix for accessible primitives, Vitest + Testing Library.

### Routes
```
/login /register /verify-email /forgot-password /reset-password
/app (AppShell, protected)
  /dashboard
  /content            list (filters)   /content/new  /content/:id
  /calendar
  /clients            /clients/:id (tabs: Overview | Campaigns | Communications | Invoices)
  /campaigns          /campaigns/:id (tabs: Overview | Deliverables | Tasks | Communications | Invoices)
  /tasks
  /communications
  /finance            invoices | payments   /finance/invoices/:id
  /settings           profile | security | preferences | integrations | data
  /ai                 (later)
```

### Component hierarchy
```
<App>
 ├ <AuthProvider>  (access token in memory, refresh on 401)
 ├ <QueryClientProvider>
 └ <Router>
    ├ Public layout → LoginForm / RegisterForm / ...
    └ <ProtectedRoute> → <AppShell>
        ├ <Sidebar/> <Topbar>(search, notifications bell, user menu)</Topbar>
        └ <Outlet/> pages:
            DashboardPage → TodayPosts, DueTasks, OutstandingBalanceCard(per currency), ActiveCampaigns, RecentComms
            ContentListPage → FilterBar, ContentCard/Table, Pagination
            ContentEditorPage → ContentForm, MediaUploader, CategoryPicker, TagInput, PostsPanel
            CalendarPage → CalendarToolbar, CalendarGrid, PostChip, OverlayToggles, PostDrawer(StatusBadge, MarkPublishedDialog)
            ClientsPage / ClientDetailPage → ClientForm, ContactList, Tabs…
            CampaignDetailPage → DeliverableTable, CampaignFinancePanel…
            TasksPage → TaskList, TaskForm, ReminderPicker
            CommunicationsTimeline → CommEntry, CommForm
            InvoiceDetailPage → LineItemsEditor, PaymentList, RecordPaymentDialog, BalanceSummary
            SettingsPage → ProfileForm, PasswordForm, SessionsList
 shared/ → Button, Input, Select, Modal/Dialog, Drawer, Toast, EmptyState, ConfirmDialog, StatusBadge, MoneyText, DateTimeText, DataTable, Skeleton, ErrorBoundary
```
Rules: no secrets in client; only `VITE_API_BASE_URL` is public config; money formatting via one `MoneyText`; all server state via query hooks in `features/<module>/api`.

---

## 6. Auth, authorization & data isolation

1. **Passwords**: argon2id (or bcrypt cost 12), never logged/returned.
2. **Tokens**: access JWT (HS256 → consider RS256/EdDSA later), 15 min, claims `{sub, tv}`; held in JS memory. Refresh token: opaque random 256-bit, httpOnly + Secure + SameSite=Strict(Lax if cross-site hosting) cookie scoped to `/api/v1/auth`, rotated each use, stored SHA-256 hashed, reuse detection revokes family. CSRF risk limited to refresh endpoint; mitigated with SameSite + custom header check.
3. **Authorization**: no roles in MVP; the single rule is `resource.owner === req.user.id`. Enforced by:
   - `req.user` set by `authenticate` middleware (re-checks user exists & `tokenVersion`).
   - Base repository/service helper `scoped(Model, req.user.id)` that *always* adds `{owner}`; raw `Model.find` outside it is disallowed by lint rule/code review.
   - Create: `owner` taken from token, never body.
   - Update/delete: `findOneAndUpdate({_id, owner})`; no match → 404.
   - References: `assertOwned()` for every foreign id (D2).
   - Aggregations (`/finance/summary`, dashboard) must start with `$match:{owner}`.
4. **Hardening**: Zod `.strict()` schemas (reject unknown keys), `express-mongo-sanitize`, `hpp`, body size limits, Helmet, CORS allow-list from env, rate limits (auth strict, global moderate), generic auth error messages, account lockout/backoff.
5. **Cloudinary**: per-user folder `creatordesk/{userId}/...` in signed upload params; `POST /media` verifies publicId prefix.
6. **Secrets**: all in server env; `.env` git-ignored; `.env.example` committed; social/AI tokens encrypted at rest.
7. **Automated isolation tests** (see §8) are a merge-blocking requirement.

---

## 7. Phased roadmap & dependencies

```
P1 Foundation+Auth ──► P2 Content+Media ──► P3 Calendar/Posts ─┐
        │                                                       ├► P8 Dashboard
        ├──────────────► P4 Clients+Comms ──► P5 Campaigns ─────┤
        │                      │                  │             │
        │                      └──► P6 Tasks+Reminders (needs P3,P4,P5 for links; core can start after P1)
        │                                         │
        └──────────────────────────► P7 Invoices+Payments (needs P4, P5)
P9 AI (needs P2,P4,P5,P7 data) ;  P10 Social integrations (needs P3) ; P11 Hardening/Deploy
```

| Phase | Scope | Depends on |
|---|---|---|
| **P1** | Repo scaffold, tooling, config, Mongo connection, error/logging, auth (register/login/refresh/logout/profile/reset/verify), owner-scoping helpers, isolation test harness, React shell + auth pages + protected routing | — |
| P2 | Categories, Content CRUD, Cloudinary signed uploads, MediaAsset | P1 |
| P3 | Posts, calendar, honest publish workflow, job runner + notifications skeleton | P2 |
| P4 | Clients, contacts, Communications, follow-up (stub link) | P1 |
| P5 | Campaigns, Deliverables, summaries | P4 (P2/P3 for links) |
| P6 | Tasks, reminders, notification delivery, today/overdue views | P1; links need P4/P5 |
| P7 | Invoices, payments, balances, finance summary | P4, P5 |
| P8 | Dashboard, global search, calendar overlays | P3–P7 |
| P9 | AI service layer + features | P2,P4,P5,P7 |
| P10 | Social platform adapters (OAuth, token vault, publish-via-API) | P3 |
| P11 | Email provider, PDF, backups, CI/CD, monitoring, load/security pass | all |

Order of P4/P6/P7 can be adjusted by your priority (see questions).

---

## 8. Testing strategy

**Tooling:** Backend — Vitest or Jest + Supertest + `mongodb-memory-server` (replica set mode for transactions). Frontend — Vitest + React Testing Library + MSW. E2E — Playwright. CI runs lint, tests, `npm audit`.

**Cross-cutting (all modules)**
- *Isolation matrix* (generated per resource): user B gets 404 on GET/PATCH/DELETE/action of A's resource; list never includes A's rows; creating with A's foreign ids → 404/422; body `owner` ignored.
- Validation: unknown fields rejected, boundary lengths, bad ObjectIds → 400.
- Unauthenticated → 401 on every non-public route (auto-enumerate routes).

| Module | Unit | Integration (API) | UI / E2E |
|---|---|---|---|
| Auth | hashing, token issue/rotate, reuse detection, lockout | register→login→refresh→logout, reset flow, expired/tampered tokens, rate limit, no enumeration | login form errors, auto-refresh, protected redirect |
| Content | tag normalization, status transitions | CRUD, filters/search, category deletion rule, signature endpoint constraints | create/edit with upload (mocked Cloudinary), filters |
| Calendar/Posts | **status state-machine** (no `published` without verification), conflict detection, timezone/DST | schedule, mark-published, missed sweep, job idempotence/atomic claim | drag-reschedule, label wording "Scheduled (reminder)", mark-published dialog |
| CRM | duplicate-name rule, archive guards | CRUD, contacts, summary aggregates | create client, detail tabs |
| Campaigns | date validation, summary math | CRUD, deliverables, cross-owner client ref | deliverable table flow |
| Tasks | overdue calc, recurrence, reminder scheduling | filters, complete/reopen, reminder job fires once | today/overdue lists |
| Comms | follow-up task creation (transaction rollback) | filters, search, timeline order | log entry, timeline |
| Payments | **money math** (rounding, tax, partials, overpayment), derived status, numbering concurrency | invoice lifecycle, immutability, per-currency summary | invoice builder, record payment, balance display |
| Dashboard | aggregation correctness | scoped aggregates | smoke |
| AI | prompt builders, redaction | provider mocked, rate limit, failure fallback | suggestion accept/discard |
| Security | — | headers, CORS, NoSQL injection payloads, oversized body | — |

---

## 9. Environment variables & integrations

### Server (`server/.env`, never committed)
```
NODE_ENV, PORT, APP_BASE_URL, CLIENT_ORIGIN (CORS allow-list, comma-separated)
MONGODB_URI
JWT_ACCESS_SECRET, JWT_ACCESS_TTL=15m
REFRESH_TOKEN_TTL_DAYS=30, COOKIE_DOMAIN, COOKIE_SECURE
PASSWORD_HASH_COST (or ARGON2_*)
RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, AUTH_RATE_LIMIT_MAX
CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_UPLOAD_PRESET?
MAIL_PROVIDER, MAIL_API_KEY, MAIL_FROM          # Phase 1 uses console mailer in dev
TOKEN_ENCRYPTION_KEY                            # for social tokens (P10)
AI_PROVIDER, AI_API_KEY, AI_MODEL, AI_DAILY_LIMIT_PER_USER   # P9
INSTAGRAM_APP_ID/SECRET, GOOGLE_CLIENT_ID/SECRET, TIKTOK_*   # P10
LOG_LEVEL, SENTRY_DSN (optional)
```
### Client (`client/.env`) — public only
```
VITE_API_BASE_URL
```
(+ `VITE_CLOUDINARY_CLOUD_NAME` is public and acceptable; API key/secret are NOT.)

### External integrations
| Integration | Phase | Notes |
|---|---|---|
| MongoDB Atlas (or local replica set) | P1 | Transactions need replica set |
| Cloudinary | P2 | Signed uploads |
| Email (Resend/Postmark/SES) | P1 stub, P11 real | Verification/reset/reminders |
| LLM API (Anthropic or other) | P9 | Behind `AiProvider` interface |
| Instagram Graph / YouTube Data / TikTok | P10 | Behind `PublishingAdapter` interface: `connect()`, `publish(post)`, `getStatus(id)` |
| Error monitoring (Sentry) | P11 | optional |

Extensibility seams built in Phase 1–3: `integrations/` folder with interfaces, `Post.verification`, `SocialAccount` schema, feature flags in config, job runner abstraction.

---

## 10. Proposed folder structure

```
CMS/
├─ docs/                 PLAN.md, decisions/ (ADRs), api/ (OpenAPI later)
├─ server/
│  ├─ src/
│  │  ├─ app.js          express app (no listen) – testable
│  │  ├─ server.js       boot, DB connect, graceful shutdown
│  │  ├─ config/         env.js (validated with Zod), db.js, logger.js
│  │  ├─ middleware/     authenticate, validate, errorHandler, rateLimit, requestId, notFound
│  │  ├─ modules/
│  │  │  ├─ auth/        routes, controller, service, schemas(zod), model(s)
│  │  │  ├─ users/
│  │  │  ├─ content/  categories/  media/  posts/  clients/  campaigns/
│  │  │  ├─ tasks/  notifications/  communications/  invoices/  payments/
│  │  │  └─ dashboard/
│  │  ├─ integrations/   cloudinary/, mail/, ai/, social/  (interfaces + adapters)
│  │  ├─ jobs/           runner.js, reminders.js, postSweep.js
│  │  ├─ lib/            scoped.js (owner scoping), assertOwned.js, money.js, errors.js, pagination.js
│  │  └─ routes.js
│  ├─ tests/ (unit/, integration/, helpers/, isolation/)
│  ├─ .env.example
│  └─ package.json
├─ client/
│  ├─ src/
│  │  ├─ app/            App.jsx, router.jsx, providers
│  │  ├─ features/       auth/, content/, calendar/, clients/, campaigns/, tasks/, comms/, finance/, dashboard/, settings/
│  │  ├─ components/     ui/ (primitives), layout/
│  │  ├─ lib/            apiClient.js (refresh interceptor), money.js, dates.js
│  │  └─ main.jsx
│  ├─ tests/  .env.example  tailwind.config.js  vite.config.js
├─ e2e/                  Playwright
├─ package.json          npm workspaces + shared scripts
├─ .editorconfig .gitignore .prettierrc eslint config
└─ README.md
```

## 11. Phase 1 — implementation order

1. `git init`, `.gitignore`, workspaces, ESLint/Prettier, `.editorconfig`.
2. Server skeleton: env validation (fail fast), logger, Express app/server split, `/health`, error handler, request id, security middleware.
3. Mongo connection + User, Session, VerificationToken models and indexes.
4. Shared libs: `errors`, `scoped`, `assertOwned`, `pagination`, `money` (money used from P7, but test now).
5. Auth service: register, login (lockout), refresh rotation + reuse detection, logout/all, `/me`, change password, verify/reset (console mailer).
6. `authenticate` middleware + a **sample owner-scoped resource** (`Category`) used purely to prove the isolation pattern and test harness.
7. Isolation test helper (reusable "two users" matrix).
8. Client skeleton: Vite + Tailwind, router, AuthProvider, API client with refresh interceptor, Login/Register/Forgot/Reset/Verify pages, AppShell, ProtectedRoute, empty Dashboard, Settings (profile + password).
9. CI workflow (lint, test, audit), README with setup steps.

## 12. Phase 1 — acceptance criteria

- [ ] `npm install && npm run dev` starts server and client; `/api/v1/health` returns 200 and DB status.
- [ ] Server refuses to boot with missing/weak required env vars; no secret appears in client bundle (verified by grep of `dist/`).
- [ ] Register → verify (dev console link) → login works; duplicate email gives a safe error; password stored only as hash.
- [ ] Access token expires in ≤15 min; refresh cookie is httpOnly/Secure(prod)/SameSite; refresh rotates; replaying an old refresh token revokes the session family.
- [ ] Logout and logout-all invalidate sessions; change password invalidates other sessions.
- [ ] Login/register/forgot are rate-limited; reset responses don't reveal whether an email exists.
- [ ] Unauthenticated calls to protected routes → 401; client redirects to login and returns to intended page.
- [ ] Sample `Category` resource: user B receives 404 for A's id on GET/PATCH/DELETE, never sees A's rows in lists; body `owner` ignored; foreign reference rejected.
- [ ] Every document has `createdAt`/`updatedAt`.
- [ ] Unit + integration tests pass in CI, coverage ≥80% on auth services; ESLint clean; `npm audit` has no high/critical.
- [ ] README documents setup; `.env.example` complete.
- [ ] **Out of scope for P1:** content, media, calendar, CRM, payments, AI, real email, social APIs.

---

## 13. Open questions (need your decision before P1 starts)

See bottom of chat response; answers to be recorded here as ADRs.
