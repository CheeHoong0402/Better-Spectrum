# Better Spectrum

A private student dashboard MVP for SPeCTRUM course updates, assignment tracking, timetable reminders, and iPhone web push.

## Features

- Responsive dashboard designed for installation on an iPhone Home Screen.
- Weekly timetable and dated class reminders.
- Manual deadlines and task completion tracking.
- Announcement and course-material change feed.
- Scheduled web-push reminders when the computer is off.
- Optional Moodle-compatible integration for courses, assignments, forums, and course materials.
- Password-protected API, encrypted saved access tokens, and bounded push retries.

## Local development

Requires Node.js 22 or later.

1. Install dependencies with `npm install`.
2. Run `node scripts/local-setup.mjs` to create local-only credentials.
3. Initialize the local database with `npm run db:local`.
4. Start the local app with `npm run dev` and open `http://localhost:8787`.
5. Use the local-only password `local-preview-only`.

## Deployment

Create your own Cloudflare Worker and D1 database, then replace the placeholder D1 ID in `wrangler.jsonc`. Initialize the database with `wrangler d1 execute student-manager --remote --file=schema.sql`, deploy with `wrangler deploy`, set `PLANNER_URL` to your Worker address, then run `node scripts/production-secrets.mjs` to generate credentials for your own deployment. Never commit `.dev.vars`, `.private/`, `.wrangler/`, or real account credentials.

## Boundaries

- iPhone notifications require adding the site to the Home Screen, granting notification permission, and testing delivery on the actual device.
- Moodle API access requires a supported service token. Never enter a university password into this app.
- Attendance reminders are supported; the MVP does not automatically mark attendance.
- Add class dates based on your own verified timetable. The repository contains no personal timetable records.
- Review the Moodle sync limits in `src/moodle.js` before relying on it for every forum reply or submission status.
- Provider acceptance does not guarantee that a phone displayed the notification. Free-plan limits and current provider behavior should be checked for your own deployment.
