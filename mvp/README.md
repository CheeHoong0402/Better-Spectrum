# Better Spectrum app

This is the single application source. See the [repository README](../README.md) for local setup, checks, timetable behaviour and current boundaries, and [DEPLOYMENT.md](DEPLOYMENT.md) for production configuration and releases.

`src/` contains the Worker, semester rules, Moodle integration and service-worker template. `public/` contains the web app and logo assets. `migrations/` contains additive D1 migrations. `scripts/` contains local setup, icon rendering, backup, build, deployment and verification tools.

Private records live in D1, never in source or public assets. `.dev.vars`, `.private/`, `.wrangler/` and `wrangler.production.jsonc` are excluded from Git. Generated `public/sw.js` and `public/release.json` are built before development and deployment.


## Attendance assistance

Settings → Timetable & attendance has an opt-in Auto-mark attendance switch (off by default), a separate attendance sign-in, course checks, and per-session confirmation. Siswa credentials are sent only to SPeCTRUM for login and are not stored. The authenticated browser session is encrypted with AUTH_SECRET. The account must match course sync. Session expiry, MFA or university SSO may require reconnecting or manual marking; browser cookies already on a phone are not available to the Worker.

Discovery reads the normal attendance report, never the Moodle mobile activity handler: that handler can mark multiple open sessions simply by loading it. Scope uses current group membership, reviewed section ancestry, and explicit session group labels. Unlabelled/shared sessions remain visible. The English report parser rejects unsupported layouts and ambiguous duplicate rows. Today and tomorrow are shown, with confirmation available on the class date. The student explicitly selects the corresponding saved class; the app does not infer attendance from a timetable.

While enabled, the scheduler checks one eligible confirmed session every two minutes, rotating waiting sessions. Without an eligible confirmation, it discovers sessions near saved classes. Course sync uses the alternating minutes to stay within the free Worker query budget. Timetable changes/cancellations invalidate confirmations. WIX1003 is always manual; passwords, QR codes and network restrictions are never supplied or bypassed. Regular class reminders remain available for WIX1003, with a direct course link in Settings.

A confirmed simple session uses the single-session web attendance form. Its GET can itself mark attendance when Moodle auto-assigns status, so the attempt is persisted before GET. Otherwise only an offered Present/Hadir option is submitted, after rechecking the setting and class. Recorded sessions are not overwritten. Results are read back from the exact report row before an idempotent completion push is queued for subscribed devices. Failed/uncertain attempts require manual checking and are not blindly retried. Turning the switch off clears pending confirmations; a request already sent may still finish. Reconnecting course sync clears the separate attendance connection and disables marking.

Migration 0003 only adds attendance state. No existing class, task, update or SPeCTRUM attendance record is migrated or changed. Unit/integration tests cover sign-in account matching, encrypted session persistence, off/confirmation guards, group and cancellation checks, password/QR fallback, single-session GET/POST, verified notifications, uncertain writes and session expiry. Live sign-in and the first real mark still require the student to connect and confirm a session they actually attend.
