# Multi-user migration and release

The working tree now supports invited users in one Worker deployment and one D1 database. Production remains on the previous single-user release until the steps below are completed. Do not apply migration 0004 through an ordinary unattended release.

## Auth setup

The new project is `better-spectrum-auth`, in Singapore. [Supabase dashboard](https://supabase.com/dashboard/project/tvibpahziltzarsuyjji/auth/users).

Its URL, publishable key and the requested owner email are saved locally in ignored `.private/auth.json`; local Worker configuration also has the URL/key and its own data-encryption key. No secret key is committed. The Supabase connector does not expose email templates, SMTP configuration or Auth user provisioning.

Before cutover:

1. Public sign-ups are disabled in Supabase Auth (saved in the dashboard). Only pre-provisioned users are admitted by the app's D1 allowlist regardless of provider sign-up settings.
2. Set the email OTP template to include `{{ .Token }}`. The app asks for the eight-digit code, supports paste and mobile one-time-code autofill, and does not use a magic-link redirect. OTP expiry is already set to ten minutes in the dashboard. The existing eight-digit OTP length is retained.
3. Configure and test a production SMTP sender for invited recipients. The provider's default mail service has restrictions and is not the sending plan for the group.
4. Provide the project's server-side secret key locally using `SUPABASE_SECRET_KEY`, or the ignored `.private/auth.json` `secretKey` field. Do not put it in Git, the frontend, URLs or chat. It is used only by the provisioning script, never uploaded to the planner Worker.
5. Run `node scripts/provision-user.mjs OWNER_EMAIL --owner`, using the owner email saved in `.private/auth.json`. This pre-admits an email identity without a password or invitation email and saves its immutable subject in `.private/invite-legacy-owner.json`. Admin confirmation allows OTP login with public sign-ups disabled; the owner's successful code verification still proves control of the mailbox before the app grants a session.

The project, public configuration, disabled public sign-ups, ten-minute OTP expiry, Gmail SMTP settings and code email template are saved. Gmail uses `smtp.gmail.com:587` with the full sender email as its username; the app password was entered by the operator in the dashboard. The server key was verified locally, the owner identity is provisioned, and the operator confirmed receipt of the eight-digit code email. Cloudflare is authenticated and both production queues exist with 24-hour retention. A verified live backup passed the isolated migration rehearsal, including record counts, university identity, credential conversion, foreign keys and restore. Full app login and production cutover remain pending.

## Local verification

Run from `publish/mvp`:

```text
npm run check
npm test
npm run test:http
npm run build
npx wrangler deploy --dry-run --outdir .private/bundle-check
```

HTTP tests create their own disposable D1 database and seed random, temporary sessions directly in that test database. They add no bypass login endpoint. They exercise separate users, saved records, logout, stale account headers and cron-to-queue consumption. Unit tests mock the Auth server for OTP verification and replay/concurrency failures. Migration tests use the legacy schema, preserve record identifiers/revisions/overrides/recovery/history, re-encrypt credentials and restore a foreign-key-valid backup. These checks do not prove real email delivery, real-phone push display or 50-user throughput.

## Production maintenance and migration

1. Complete Auth setup and rehearse the following process on a separate database copy. Ensure the existing SPeCTRUM course token can still verify its owner; renew it before migration if necessary.
2. Preserve the original `.private/secrets.json`, especially its legacy `AUTH_SECRET`. Add a distinct `DATA_ENCRYPTION_KEY` through `scripts/production-secrets.mjs`. Keep that key backed up; do not rotate it without a re-encryption migration. This script keeps existing private migration credentials locally and uploads only the new encryption/VAPID secrets.
3. Generate production config with `scripts/production-config.mjs`. Configure `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` as GitHub Actions variables as well. Create the two queues named in the generated config (`WORKER_NAME-jobs` and `WORKER_NAME-failed`) after checking the account's plan and usage budget. The same Worker is the producer and consumer.
4. Deploy the reviewed new Worker directly with `MAINTENANCE=1` and a known `APP_RELEASE`. Ordinary `npm run deploy` deliberately refuses an unmigrated database. Maintenance blocks private reads/writes, scheduled dispatch and queue execution before accessing the changed schema.
5. Verify `/api/version` reports the expected release and `maintenance: true`, and `/api/state` returns 503. Record this time in `MAINTENANCE_STARTED_AT` as an epoch in milliseconds. Wait fifteen minutes for previous-generation requests and cron invocations to drain. Keep all production editors closed.
6. Run `node scripts/migrate-users.mjs --remote` to inspect the database without changing it. When ready, run `node scripts/migrate-users.mjs --remote --apply`. The script verifies maintenance/draining, takes a verified backup, rejects unclassified settings, applies 0004, checks record counts, pins the original Moodle identity, re-encrypts credentials for `legacy-owner`, turns attendance off and activates only the explicitly provisioned owner subject. It records completed migration names so ordinary future releases do not reapply 0004.
7. If anything fails, keep maintenance enabled. Inspect `.private/multi-user-migration.sql` and the migration report privately. Never continue past a failed count, credential or foreign-key check. Some import failures may need restoring the verified backup while still in maintenance.
8. Remove `MAINTENANCE=1` only after a successful isolated rehearsal and verified production migration. Prove owner email login, original records, semester editing, course connection, logout/reload and notification registration. Every old passphrase/native-owner cookie is rejected. Devices must register notifications again; existing migrated endpoints can be reclaimed only by their original owner.
9. Invite a second identity with `node scripts/provision-user.mjs INVITED_EMAIL`. Review and apply the generated `.private/invite-USER_ID.sql` file to the intended D1 database. Confirm that the new planner is empty and cannot access the owner's records. Each student connects their own SPeCTRUM account. Expand invitations gradually.

Do not claim this is a free 50-user service. Measure queue age, D1 reads/writes, upstream requests and course-rotation latency before increasing invitations. Each course job currently aims to run every fifteen minutes; reminder and eligible attendance jobs run at minute-level intervals. These are scheduling targets, not delivery guarantees. Push titles/bodies are generic to protect shared devices; messages already accepted by a push provider cannot be recalled.

## Operations and rollback

`node scripts/manage-user.mjs suspend USER_ID` disables only that user, increments their connection generation, revokes their sessions/devices and removes queued work/pairings. `node scripts/manage-user.mjs remove USER_ID` also permanently removes that planner's live records using ownership foreign keys. Removal is an explicit operator action; take the appropriate private backup first. Existing backups retain removed records until the operator's retention period expires; maintain a seven-day rolling local backup policy for this small group and restrict access to the operator. Cloudflare's configured recovery retention also applies.

Use the temporary `PLANNER_SESSION` environment variable with `scripts/production-check.mjs` to verify a real signed-in owner session without logging a cookie or private records. Do not save this variable in CI.

Before any second user's writes, a coordinated restore of the verified pre-migration backup and its matching code can reverse the cutover. After multiple users write, old ownerless code is not a compatible rollback. Use only a schema-compatible multi-user release or keep maintenance enabled and roll forward. Never overwrite new users' data with the old single-user backup.

Keep failed jobs visible in D1 (`status='failed'`, redacted `error`) and the failed-job queue. Manual course sync requests queue jobs rather than waiting for university requests. Repeated failures are bounded. Never replay an uncertain attendance submission: the persisted attempt remains authoritative and later checks only read its result.
