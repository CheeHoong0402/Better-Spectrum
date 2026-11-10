# Better Spectrum iPhone companion

The companion displays the shared hosted planner in WKWebView. It now uses the same invited email-code login as Safari and desktop. The single-owner university callback bridge has been removed; the server rejects its former login endpoints and cookies. SPeCTRUM course and attendance connections remain separate, per-student planner features.

This is source for a build check, not an installable iPhone release. The GitHub Actions workflow uses a hosted Mac, XcodeGen and the iPhone simulator SDK. A simulator build cannot be installed on a phone.

On a Mac with Xcode and XcodeGen:

```sh
cd ios
xcodegen generate
open BetterSpectrum.xcodeproj
```

Select the signing team and provision the bundle identifier before signing. TestFlight distribution still needs a signed device build, Apple Developer membership and App Store Connect configuration; none is provisioned by the planner migration. Native notification setup is not implemented. Safari/Home Screen subscriptions and cookies are separate from WKWebView.

The planner origin is pinned in source. Before distributing the companion, verify real email-code delivery and autofill/paste, sign-out, account switching, session persistence and a fresh install on an actual iPhone. Complete the [server migration](../mvp/MULTI_USER_MIGRATION.md) first. The initial supported installation path remains the Safari PWA.
