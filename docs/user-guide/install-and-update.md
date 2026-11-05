# Install, update and uninstall

Avchetan is published on its **[GitHub Releases page](https://github.com/tulsiram-sunrise/avchetan/releases/latest)**. It isn't in the Microsoft Store or Google Play yet. Each release has these files:

| File | For |
|---|---|
| `avchetan-v<version>-windows-x64-setup.exe` | Windows 10 or 11, 64-bit. Contains the desktop app and the Home Hub. |
| `avchetan-v<version>-android.apk` | Android phones. |
| `SHA256SUMS.txt` | Checksums, to check that a download is complete and unchanged. |

The setup guides ([one device](setup-standalone.md), [Home Hub](setup-home-hub.md), [pair your phone](pair-your-phone.md)) say which file to use and when.

## Windows

1. Download the file ending in `windows-x64-setup.exe` and open it.
2. If Windows says **Windows protected your PC**, click **More info**, then **Run anyway**. Windows shows this warning for programs that aren't signed with a code-signing certificate yet, and Avchetan's installer isn't signed yet. If you want to be sure the file is the real one, [check it](#check-a-download) first.
3. The installer needs no administrator rights. It installs Avchetan for your Windows account only.

## Android

1. On the phone, open the [Releases page](https://github.com/tulsiram-sunrise/avchetan/releases/latest) in the browser and download the file ending in `android.apk`.
2. Open the downloaded file. Android asks you to allow the browser to install apps: tap **Settings**, turn on **Allow from this source**, and go back.
3. If Google Play Protect warns that the app is unknown, tap **More details**, then **Install anyway**. Play Protect warns about any app that isn't from Google Play.

You only allow installing from the browser once. You can turn it off again afterwards in Android's settings, under **Apps → Special app access → Install unknown apps**.

## Check a download

This is optional. Checking proves that the file you downloaded is the one the release built.

**Windows installer.** Download `SHA256SUMS.txt` from the same release. In PowerShell, in your Downloads folder, run:

```powershell
Get-FileHash .\avchetan-v0.1.0-windows-x64-setup.exe
```

Use your file's name. The long `Hash` it prints must match the line for that file in `SHA256SUMS.txt`. Capital and small letters don't matter. If it doesn't match, delete the file and download it again.

**Android app.** Every Avchetan APK is signed with the same key. Its certificate's SHA-256 fingerprint is:

```
1f:a7:be:42:a5:fe:02:16:af:c2:37:93:9c:00:3c:79:86:34:3c:ce:80:92:45:2f:49:d3:03:d3:e3:7c:9d:cc
```

After the first install, Android checks this for you: it refuses to install an update signed with a different key. To check the first download, compare its checksum the same way (`Get-FileHash` on a PC, or `sha256sum` on Linux), or, if you have the Android SDK, run `apksigner verify --print-certs` on the file.

## Update

Avchetan doesn't check for updates by itself yet. To hear about new versions, open the project on GitHub, click **Watch → Custom**, tick **Releases**, and click **Apply**.

- **Windows:** quit Avchetan (right-click its icon in the taskbar's notification area → **Quit Avchetan**), download the new installer and run it. Your entries and settings stay.
- **Android:** download the new APK and open it. Android installs it over the old one, and your entries and settings stay.

Update every device that syncs together to the same version. Your version is shown in **Settings → About** on Windows and at the bottom of **More** on Android.

## Uninstall

- **Windows:** **Settings → Apps → Installed apps**, find **Avchetan**, then **⋯ → Uninstall**. The uninstaller asks whether to delete the app's data as well. Leave that unticked to keep your entries for a later install. The tokens and API keys Avchetan saved stay in Windows' Credential Manager under `app.avchetan`. Remove them there if you won't install Avchetan again.
- **Android:** press and hold the Avchetan icon, then **Uninstall**. This deletes everything the app stored on the phone. If the phone syncs with a hub or server, let it sync first. The entries come back when you install and pair again.

The Home Hub's data on the PC is stored with the app's data, so deleting the app's data deletes the hub's copy of every device's entries. [Export or back up](backup-and-restore.md) first if you aren't sure.
