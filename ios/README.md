# Better Spectrum iPhone sign-in companion

This is an initial sign-in implementation, not an installable release. It reuses the existing hosted planner in WKWebView and opens university sign-in in ASWebAuthenticationSession. The university handles passwords and MFA. The callback is posted over HTTPS to the planner, bound to the originating web view's encrypted HttpOnly challenge cookie. The server verifies the token against SPeCTRUM and the existing planner owner before issuing a session.

## Build and install

The `Check iPhone companion` GitHub Actions workflow uses a hosted Mac to generate the Xcode project with XcodeGen and compile for the simulator. A local Mac is not required for that check. A simulator build cannot be installed on an iPhone.

The regular `npm run test:http` check now also starts a separate disposable Worker with `PLANNER_LOGIN=spectrum`. It verifies rejection of passphrase login, unauthenticated writes, cross-origin requests and malformed callbacks, along with encrypted challenge-cookie issuance. It does not contact SPeCTRUM or establish a real university session. Successful owner verification, session issuance and replay prevention are separately covered by the automated Worker tests with a mocked university API.

To distribute through TestFlight, an Apple Developer Program membership, signing configuration, an App Store Connect app and a signed device build are required. No enrolment or purchase is automated. Native notification delivery and installation are not implemented by this build-check workflow.

For a Mac with Xcode and XcodeGen:

```sh
cd ios
xcodegen generate
open BetterSpectrum.xcodeproj
```

Select the signing team and provision `app.betterspectrum.planner`, or change that bundle identifier before signing. The companion's planner origin and callback scheme are pinned in the source. Never point a production companion at an untrusted host.

## Server cutover gate

Keep production's current login until a signed companion succeeds on the actual iPhone. Test against a separate HTTPS Worker and database copy first; update the companion's planner origin for that staging build. Keep the existing encrypted course-sync token in that staging database so the first login can identify the existing owner.

Set `PLANNER_LOGIN=spectrum` only on that test Worker. This disables passphrase login and rejects previously issued passphrase sessions. The first successful sign-in must match the existing course-sync account; its numeric Moodle user ID is then pinned in `planner_owner`. Subsequent sign-ins are restricted to that ID even if the connected token changes. An email typed into a form is never treated as proof of identity.

The callback can contain a token without a private token, which is sufficient for identity verification. This login does not change attendance opt-in or attendance sessions. It refreshes the encrypted course-sync token after owner verification. Invalid, expired, mismatched, replayed and other-account callbacks fail closed. No university password is handled by this app or Worker.

Before production cutover, verify real SPeCTRUM/MFA, callback handling, cancellation/retry, reload/session persistence, logout, expired university tokens, wrong-account rejection and existing reminders. WKWebView does not automatically inherit the Safari/Home Screen app's notification subscriptions or login cookies; native notification setup needs separate validation/implementation. Native sign-in is not yet a replacement for Safari-only access.

When those checks pass, take a verified database backup, deploy the tested release with `PLANNER_LOGIN=spectrum`, and verify that the old `/api/login` password path and old cookies fail. Keep a known rollback release and backup. Do not enable the switch before there is a working device installation.
