# Operations: logging, monitoring, backup and recovery

These are recommendations plus the behaviour the code actually has. Nothing below has been exercised against a production environment; **test your restore procedure before you need it.**

## Logging (implemented)

- One JSON object per line. Info goes to stdout, warnings and errors to stderr: any host collects both.
- `LOG_LEVEL=silent|error|warn|info` (default `info`; `silent` under tests).
- Each HTTP request logs once when it finishes: `requestId`, `method`, route pattern (never the query string), `status`, duration in ms, `userId`. 5xx are `error`, 4xx are `warn`. Health probes are not logged.
- Every response has an `X-Request-Id` header (an incoming one is reused if it is 8-64 safe characters, otherwise a UUID is generated). The id is deliberately **not** in error bodies (so a foreign record and a missing record return identical bodies); support can ask the user for the `X-Request-Id` response header from the browser network tab, or find the request by user id and time.
- Unhandled errors log the name, message and stack with the request id. Request bodies, headers, cookies, tokens and API keys are never logged.
- In production, error responses for 5xx say only "Something went wrong".

Ship logs somewhere searchable (your host's log drain, Better Stack, Datadog, CloudWatch, Grafana Loki...) and keep them 30 days; they contain user ids, so treat them as personal data.

## Monitoring (recommended; none of these are configured by the project)

| What | How | Alert when |
|---|---|---|
| Is the process up | External HTTP check on `/api/v1/health` every minute | 2 consecutive failures |
| Can it serve | `/api/v1/health/ready` (returns 503 if MongoDB is disconnected) | any failure for 3 minutes |
| Errors | Count log lines with `"level":"error"` | more than 5 in 5 minutes, or any `unhandled error` |
| Latency | p95 of the `ms` field on `request` lines | p95 over 1000 ms for 10 minutes |
| Auth abuse | Count `request` lines with `status` 429 or 401 on `/api/v1/auth/*` | sudden spike |
| Database | Atlas alerts: connections, CPU, disk, replication lag, slow queries (Performance Advisor) | defaults plus disk 80% |
| Reminder job | Log lines `reminder sweep failed` | any |
| AI spend | The provider's billing dashboard and a monthly cap there; per-user limits in CMS are the second line | 80% of budget |
| Uptime of storage | Cloudinary dashboard usage and bandwidth | 80% of plan |

An error tracker such as Sentry is not integrated. Adding one means installing its SDK in `server/src/middleware/errorHandler.js`; scrub request bodies before sending.

## Backups

What holds data:

| Data | Where | Backup |
|---|---|---|
| Everything structured (users, brands, campaigns, content, tasks, invoices, payments, communications, notifications, AI suggestions) | MongoDB | **Atlas continuous cloud backup** (point-in-time recovery, M10+), 7+ days of PITR and daily snapshots kept 30 days. Self-hosted: nightly `mongodump --uri "$MONGODB_URI" --gzip --archive=cms-$(date +%F).gz`, copied off the machine, encrypted, 30 days retention. |
| Uploaded files | Cloudinary | Cloudinary's backup option, or a periodic export through its Admin API into your own bucket. Without this, a deleted Cloudinary asset is gone. |
| Secrets | Your secret manager | Keep an offline, access-controlled copy of `JWT_ACCESS_SECRET`, Cloudinary and AI keys. Losing `JWT_ACCESS_SECRET` only signs everyone out. |
| Code | Git | The repository. |

Database records reference uploaded files by id, so back the two up together (same schedule) so a restore does not leave records pointing at missing files.

## Recovery

**Database corruption or accidental deletion**

1. Stop the API (or scale to zero) so no new writes land during the restore.
2. Atlas: restore the snapshot or a point in time into a **new** cluster first. Self-hosted: `mongorestore --uri "$NEW_URI" --gzip --archive=cms-YYYY-MM-DD.gz --nsInclude 'cms.*'`.
3. Point a staging copy of the API at the restored database and check: sign in, open a brand, open an invoice and its payments, open a content item with an image.
4. Run `npm run db:indexes -w server` against the restored database.
5. Switch production `MONGODB_URI` to the restored database and start the API.
6. Users created after the restore point are lost; tell them.

**Lost file storage:** restore the Cloudinary export. Records whose file is missing show an asset that fails to load; the app shows an error for that file and keeps working.

**Compromised secret:** rotate `JWT_ACCESS_SECRET` (everyone is signed out on their next request), rotate Cloudinary and AI keys at their providers, and revoke all sessions by deleting the `sessions` collection if refresh-token theft is suspected.

**Practice:** restore a backup into a scratch cluster once a quarter and write down how long it took. A backup that has never been restored is an assumption.

## Routine tasks

| When | Task |
|---|---|
| Every deploy | `npm run db:indexes -w server -- --dry-run`, read it, then run it without `--dry-run` |
| Weekly | Look at error logs and the Atlas Performance Advisor |
| Monthly | `npm audit --omit=dev`, update dependencies, run `npm run check` |
| Quarterly | Restore test; review users with unusually high AI or upload usage |
| On offboarding a user | There is no admin tool: remove their data with a script run against a backup-verified database |

## Capacity notes

- Every list endpoint is paginated (default 20-50, max 100-200) and every owner-scoped query is covered by a compound index starting with `owner`. Run `npm run db:indexes -w server -- --dry-run` against production to confirm the indexes exist.
- The reminder job scans due items every `REMINDER_SWEEP_SECONDS` using dedicated indexes (`status + dueDate/scheduledAt`). Raise the interval if the database is small and cost-constrained.
- Video uploads stream through the API server to Cloudinary (up to `MAX_UPLOAD_VIDEO_MB`). For heavy video use, size the API's memory and bandwidth accordingly or move to direct-to-Cloudinary signed uploads (not implemented).
