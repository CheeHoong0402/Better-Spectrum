# Production deployment

The multi-user release requires the reviewed [maintenance migration](MULTI_USER_MIGRATION.md). Normal deployment refuses a legacy database. Do not apply `schema.sql` over the live single-user app or roll back to ownerless code after other users start writing.

## One-time GitHub setup

The workflow uses these repository Actions variables:

- `WORKER_NAME`: the existing live Worker name.
- `D1_DATABASE_ID`: the existing production database UUID.
- `CLOUDFLARE_ACCOUNT_ID`: the account containing both resources.
- `PLANNER_URL`: the existing HTTPS application origin.
- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`: the configured email-login project, with a tested production sender and code template.

Add an Actions **secret** named `CLOUDFLARE_API_TOKEN`. Use a dedicated Cloudflare API token restricted to the account, with Workers Scripts Edit and D1 Edit permissions; account discovery may require Account Settings Read. Do not upload the desktop OAuth login or application passphrase. The token is for deployment, not for users signing in to the planner.

GitHub: repository → Settings → Secrets and variables → Actions. Cloudflare's official setup: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/

Pull requests and branch pushes run the check job without production credentials. Only a passing `main` commit can run the production job. Changes to schedules are always reviewed inside the app; deployment does not fill in a student's semester automatically.

## Local production configuration

`wrangler.jsonc` is deliberately for local development. Do not replace it with real account data.

Set the four variables above in your shell and run:

```text
node scripts/production-config.mjs
```

This creates ignored `wrangler.production.jsonc`. The owner's existing private configuration is already preserved locally. Wrangler's saved desktop login can deploy manually; GitHub requires its dedicated token.

For a new installation only, set `PLANNER_URL` and run `node scripts/production-secrets.mjs` to provision private app credentials. Existing production secrets must remain unchanged when updating the app.

## Release process

Commit the working tree, then:

```text
npm run deploy
```

This runs checks and tests, builds a release, records the previous Cloudflare deployment, verifies the multi-user database and active owner identity, makes a foreign-key-verified backup, applies pending migrations, deploys the Worker with its Git identifier, and checks the public URL. The initial ownership migration is a separate maintenance operation. GitHub performs normal releases after its separate check job succeeds.

The live check retries while Cloudflare propagates the deployment. Acceptance by the upload API alone is not treated as a verified release. `/api/version` returns only the release identifier; `/api/state` remains private. About also shows the identifier after sign-in.

Local backups are in `.private/backups/` and previous deployment information is in `.private/releases/`. They contain private records and must not be uploaded or committed. CI's logical SQL backup is temporary on its runner and is not uploaded as an artifact. Use D1 Time Travel for server-side recovery; save a local backup before any manual data change. Logical backups use sequential read-only queries, so pause user edits during a backup when a consistent application-level snapshot is required.

## Rollback

The GitHub deployment summary records previous Cloudflare version IDs. From `main`, run the **Roll back production** workflow with one of those IDs. Or, with your local production configuration:

```text
node scripts/rollback.mjs PREVIOUS_VERSION_ID
```

This rolls back application code, not database records. After migration 0004, only a multi-user-compatible version may be used. Ownerless releases cannot read the new schema safely. Do not automatically restore a database over newer user edits. Use a reviewed D1 Time Travel restore or a private SQL backup if data recovery is necessary.

## Existing owner's course catalogue

Earlier local versions kept course metadata in a private source file. Before the first release that removes that seed, preserve those definitions once in the D1 `settings` entry `course_catalog`. The prepared private SQL uses `ON CONFLICT DO NOTHING`, so existing catalogue data is preserved. No personal course or timetable values belong in the public migration files.
