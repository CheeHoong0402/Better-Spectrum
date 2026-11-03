# Better Spectrum

A private, single-student planner for iPhone and desktop. The app lives in `mvp/`: HTML/CSS/JavaScript, a Cloudflare Worker, and D1. No App Store or native build is required.

## Develop

Requires Node.js 22 or later and npm.

```text
cd mvp
npm ci
node scripts/local-setup.mjs
npm run db:local
npm run dev
```

Use `local-preview-only` on localhost. Local development uses `wrangler.jsonc` and a local database, with no personal seed records. Plan a semester or connect your own supported Moodle token to add courses.

```text
npm run check
npm test
npm run test:http
npm run build
```

`test:http` starts its own disposable local Worker and database. It exercises login, private access, tasks, semester preview/apply, and repeated imports. It never targets production. `build` generates the service worker and public release manifest from the current Git revision.

## Production releases

See [mvp/DEPLOYMENT.md](mvp/DEPLOYMENT.md). Pull requests run checks, unit tests, HTTP tests and a Worker dry run. A passing commit on `main` is deployed to the configured existing Worker, after a private database backup and additive migrations. Deployment verifies the live release identifier, all public asset hashes and private API protection. Branch pushes do not deploy production.

Application code has one source: this repository. Local production configuration, credentials, database backups and personal records are not committed. The original workspace's `mvp` directory is a directory link to this app; its old copy is retained only as a private archive.

## Semester timetable

Timetable → Plan semester lets you enter the term dates, excluded dates and weekly classes. Teaching weeks defaults to every week within the semester dates when left blank. To skip whole break weeks, enter specific teaching weeks. Week numbers count calendar weeks from the chosen Week 1 Monday. Per-class weeks support alternating patterns.

Preview before confirming. A repeated save updates the same semester. Existing matching dated classes are adopted and protected; individual edits and cancellations survive later updates. Removing a weekly row removes only its unedited generated occurrences. Use the date-specific class editor for a replacement class or room change. Export/import JSON preserves the schedule's identifiers; an import never writes records until preview and confirmation.

Dates must be reviewed against MAYA or TimeEdit. The app does not infer the semester from a one-week timetable. Automatic timetable retrieval and native iPhone widgets are not implemented.

## Current boundaries

- One private student account, not a shared multi-user service.
- SPeCTRUM collection requires a supported token and remains bounded by the limits in `src/moodle.js`.
- iPhone notifications require installation from Safari and a real-device delivery test. Provider acceptance does not prove phone display.
- Only public app assets are cached offline. Private offline data is not implemented yet.
- Weekly classes must start and end on the same day. Semester expansion is limited to 1,000 dated occurrences, with up to 40 weekly rows.
- Signing out ends the session; it does not delete your cloud records.
- Paid services and upgrades are not enabled by this project.
