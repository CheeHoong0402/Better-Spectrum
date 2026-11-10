# Better Spectrum app

This is the single application source. See the [repository README](../README.md) for local setup, checks, timetable behaviour and current boundaries, and [DEPLOYMENT.md](DEPLOYMENT.md) for production configuration and releases.

`src/` contains the Worker, semester rules, Moodle integration and service-worker template. `public/` contains the web app and logo assets. `migrations/` contains additive D1 migrations. `scripts/` contains local setup, icon rendering, backup, build, deployment and verification tools.

Private records live in D1, never in source or public assets. `.dev.vars`, `.private/`, `.wrangler/` and `wrangler.production.jsonc` are excluded from Git. Generated `public/sw.js` and `public/release.json` are built before development and deployment.


## Invited accounts

See [MULTI_USER_MIGRATION.md](MULTI_USER_MIGRATION.md) for Auth configuration, the maintenance migration, invitation scripts and operator removal. Login uses an invited email code; course and attendance credentials belong only to the verified planner user. The live deployment is unchanged until the migration runbook is completed.

## Attendance assistance

Settings → Timetable & attendance has an opt-in Auto-mark attendance switch (off by default), a separate attendance sign-in, course checks, and per-session confirmation. Siswa credentials are sent only to SPeCTRUM for login and are not stored. The authenticated browser session is encrypted with DATA_ENCRYPTION_KEY and authenticated to its planner owner. The account must match course sync. Session expiry, MFA or university SSO may require reconnecting or manual marking; browser cookies already on a phone are not available to the Worker.

Discovery reads the normal attendance report, never the Moodle mobile activity handler: that handler can mark multiple open sessions simply by loading it. Scope uses current group membership, reviewed section ancestry, and explicit session group labels. Unlabelled/shared sessions remain visible. The English report parser rejects unsupported layouts and ambiguous duplicate rows. Today and tomorrow are shown, with confirmation available on the class date. The student explicitly selects the corresponding saved class; the app does not infer attendance from a timetable.

While enabled, the scheduler checks one eligible confirmed session every two minutes, rotating waiting sessions. Without an eligible confirmation, it discovers sessions near saved classes. Course sync uses the alternating minutes to stay within the free Worker query budget. Timetable changes/cancellations invalidate confirmations. WIX1003 is always manual; passwords, QR codes and network restrictions are never supplied or bypassed. Regular class reminders remain available for WIX1003, with a direct course link in Settings.

A confirmed simple session uses the single-session web attendance form. Its GET can itself mark attendance when Moodle auto-assigns status, so the attempt is persisted before GET. Otherwise only an offered Present/Hadir option is submitted, after rechecking the setting and class. Recorded sessions are not overwritten. Results are read back from the exact report row before an idempotent completion push is queued for subscribed devices. Failed/uncertain attempts require manual checking and are not blindly retried. Turning the switch off clears pending confirmations; a request already sent may still finish. Reconnecting course sync clears the separate attendance connection and disables marking.

Migration 0003 only adds attendance state. No existing class, task, update or SPeCTRUM attendance record is migrated or changed. Unit/integration tests cover sign-in account matching, encrypted session persistence, off/confirmation guards, group and cancellation checks, password/QR fallback, single-session GET/POST, verified notifications, uncertain writes and session expiry. Live sign-in and the first real mark still require the student to connect and confirm a session they actually attend.

Live login feasibility correction (4 November 2026): the SPeCTRUM login page redirects to Microsoft university OIDC. The supported course-sync token does not grant a browser session. Settings now checks the connection method without credentials, explains this limitation, and hides the direct password form unless a native login form is available. University sign-in disables auto-marking and clears pending confirmations and its separate session. This deployment does not implement an interactive Microsoft authentication bridge; attendance stays manual on this configuration.


## Windows Microsoft sign-in helper

Run `scripts/start-attendance-helper.cmd` on Windows with Node.js installed. It opens a loopback-only helper page and temporarily registers the dedicated `betterspectrum-attendance` protocol in the current user's registry. It never replaces another protocol handler. The registration is removed on normal exit or after 15 minutes. The helper defaults to your usual browser and also offers Edge InPrivate. Sign out of SPeCTRUM in the chosen browser before starting, so Moodle can return the private token after a fresh sign-in. A stalled Microsoft KMSI page in InPrivate can be retried in the usual browser without changing privacy settings. The helper never reads the Microsoft password or browser cookies.

In the planner, open Settings → Timetable & attendance → Generate helper pairing code. Paste that code into the local helper and choose Sign in with Microsoft. Complete Microsoft authentication and approve opening the helper link. Refresh the helper page for the result, then refresh planner Settings. Codes expire in 10 minutes and are one-use; starting a new pairing replaces the previous code. A site-forced callback scheme or a missing private token will fail with an explanation. Do not paste credentials or callback URLs into chat or issue reports.

The helper validates the Moodle callback passport and transfers the mobile token pair only to the configured HTTPS planner. The backend verifies the student against course sync, exchanges the private token using Moodle's mobile auto-login API, and reads an eligible attendance report before saving encrypted connection credentials. Setup does not visit any marking page and leaves auto-marking off. Disconnect removes both the browser session and mobile credentials. The cloud can renew expired read-only report sessions subject to Moodle's six-minute auto-login limit; failed or refused renewal requires reconnecting. No Windows background process is needed after successful setup.

Live acceptance still requires the student to complete Microsoft sign-in and a read-only cloud verification. Only then enable the switch and confirm a real class you attend. WIX1003 remains manual. This is an independent implementation of Moodle's documented mobile handoff, informed by the architecture of skylightlim/um-timetable; no code from that repository is bundled.


## Connect attendance from an existing SPeCTRUM session

The primary connection option is now the mobile-app QR code in SPeCTRUM: refresh your signed-in profile → More Details → Mobile app → View QR code, save the QR image, then choose it in planner Settings → Timetable & attendance → Connect using QR code. No Windows helper or new Microsoft login is required for this route. This is the account sign-in QR code, not a lecturer's attendance QR code. Never share it in chat.

The browser decodes PNG/JPEG/WebP images locally with jsQR (MIT license included in the generated public decoder). It accepts images up to 4 MB, bounds pixel dimensions, and sends only the decoded mobile sign-in link to the authenticated private API. The backend pins the SPeCTRUM origin, validates the account before exchanging the one-use QR key, applies a retry limit, and reuses the mobile handoff's encrypted credentials, cancellation guard, read-only verification and session renewal. A successful setup leaves automatic marking OFF. Expired or already-used codes require a refreshed profile and new image.

The Windows helper is retained as an alternative; its Microsoft-launched flow stalled at KMSI during live testing even though the student's normal SPeCTRUM login worked. QR setup uses that working session. Live acceptance still requires a real user-approved QR exchange; fixture tests are not proof of production sign-in or attendance submission.
