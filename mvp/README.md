# Better Spectrum app

This is the single application source. See the [repository README](../README.md) for local setup, checks, timetable behaviour and current boundaries, and [DEPLOYMENT.md](DEPLOYMENT.md) for production configuration and releases.

`src/` contains the Worker, semester rules, Moodle integration and service-worker template. `public/` contains the web app and logo assets. `migrations/` contains additive D1 migrations. `scripts/` contains local setup, icon rendering, backup, build, deployment and verification tools.

Private records live in D1, never in source or public assets. `.dev.vars`, `.private/`, `.wrangler/` and `wrangler.production.jsonc` are excluded from Git. Generated `public/sw.js` and `public/release.json` are built before development and deployment.
