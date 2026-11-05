## Install

| File | For |
|---|---|
| `avchetan-{{tag}}-windows-x64-setup.exe` | Windows 10 or 11 (64-bit): the desktop app and the Home Hub |
| `avchetan-{{tag}}-android.apk` | Android phones |
| `SHA256SUMS.txt` | Checksums of both files |

New to Avchetan? Start with the [user guide](https://tulsiram-sunrise.github.io/avchetan/user-guide/getting-started): it helps you choose a setup and walks you through it.

- **Windows:** the installer isn't code-signed yet, so Windows may say **Windows protected your PC**. Click **More info**, then **Run anyway**.
- **Android:** allow your browser to install apps when Android asks. Google Play Protect may warn that the app is unknown; tap **More details → Install anyway**.
- **Checking a download:** compare `Get-FileHash <file>` with `SHA256SUMS.txt`. The APK's signing certificate has the SHA-256 fingerprint `1f:a7:be:42:a5:fe:02:16:af:c2:37:93:9c:00:3c:79:86:34:3c:ce:80:92:45:2f:49:d3:03:d3:e3:7c:9d:cc`. Details: [install, update and uninstall](https://tulsiram-sunrise.github.io/avchetan/user-guide/install-and-update).
- **Updating:** install the new files over the old ones; your data stays. Update every device that syncs together.
- **Own server:** `docker pull ghcr.io/tulsiram-sunrise/avchetan-server:{{version}}`, or build it from the source as the [cloud guide](https://tulsiram-sunrise.github.io/avchetan/user-guide/setup-cloud) shows.

Found a problem? [Report it](https://github.com/{{repository}}/issues/new?template=bug-report.yml). Security problems: see [SECURITY.md](https://github.com/{{repository}}/blob/master/SECURITY.md).

