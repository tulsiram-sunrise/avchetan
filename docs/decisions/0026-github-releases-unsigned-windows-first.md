# 0026 — Releases on GitHub only; the Windows installer starts unsigned

- **Status:** Accepted
- **Date:** 2026-11-05

## Context
The public release milestone ([roadmap](../roadmap.md#milestone--public-release-after-5b-when-shipping-to-the-outside-world)) needs a place to publish the builds and a decision on signing them.

- The Android APK is already signed with the project's release key ([releasing](../conventions/releasing.md#the-android-release-key)). Android requires that, and it also makes every later APK update the earlier one.
- The Windows installer isn't signed. Windows SmartScreen warns about an unsigned download ("Windows protected your PC") until the file gains reputation, and an installer signed with a certificate gains it faster.
- A code-signing certificate costs about $200 or more a year. Azure's signing service is cheaper but is only open to individuals in some countries. [SignPath Foundation](https://signpath.org) signs open-source projects for free, but it accepts a project only after its first release and asks for a code signing policy page and a manual approval of every release.
- Avchetan must work with no paid services (rule 13). The project itself paying for signing isn't ruled out by that rule, but it isn't needed to ship.

## Decision
- Builds are published on **GitHub Releases only**: the Windows installer, the signed APK and `SHA256SUMS.txt`, made by the release workflow from a `v*` tag. The server image goes to GitHub's container registry with the same version. Google Play, the Microsoft Store and other stores are decided later (open question Q20, now resolved as R22).
- All apps share one version, set with `pnpm version:set`. The release workflow refuses a tag that doesn't match it.
- **The Windows installer is published unsigned at first.** The user guide explains the SmartScreen warning and how to check a download against `SHA256SUMS.txt`. Release notes give the APK certificate's fingerprint.
- After the first release, the maintainer **applies to SignPath Foundation**. If accepted, the release workflow signs the app, the hub program and the installer, and the guide drops the warning ([releasing](../conventions/releasing.md#windows-code-signing)).

## Alternatives considered
- **Buy a certificate now:** costs money every year and delays the release. It doesn't remove the warning on day one either, since SmartScreen reputation still builds up over downloads.
- **Wait for SignPath before releasing:** SignPath accepts only projects that have already released.
- **Publish to the Play Store now:** needs a developer account and its review process. GitHub Releases is enough to get the first users.

## Consequences
- First-time Windows users see a warning and must click **More info → Run anyway**. The setup guides say so at the step where it happens.
- Users check updates themselves (GitHub's "Watch → Releases"), because the desktop updater needs signed update files ([roadmap](../roadmap.md#later--unscheduled)).
- Switching to SignPath changes only the release workflow and the guide, not the apps.
