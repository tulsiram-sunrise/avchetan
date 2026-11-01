# Pair your phone

> Draft — describes planned behavior.

**Goal:** connect the Avchetan phone app to your hub (or cloud server) by scanning a QR code.

1. On the PC: open Avchetan → **Settings → Devices → Pair a phone**. A QR code appears.
2. On the phone: install Avchetan from the project's GitHub Releases page (download the `.apk` file, open it, and allow installing from your browser when Android asks). Open it and choose **Connect to my hub or server**, then **Scan QR code**. Allow camera access.
3. Point the camera at the QR code. The phone connects, registers itself and starts syncing.
4. Choose how the phone uses AI:
   - **Let my hub do it** (recommended for Home Hub): your PC organizes entries and answers questions. The phone needs no AI keys.
   - **Use my own AI provider on the phone**: paste an API key.
5. Done. Close the QR screen on the PC.

## Connect by hand

Until QR pairing arrives, type the details in on each device:

1. Find your server's address, such as `http://192.168.1.20:8787`, and its sync token. The server prints the token once, the first time it starts.
2. On the phone, open **More → Sync**. On the PC, open **Settings → Sync**.
3. Enter the address and paste the token. For an address on your home network, turn on **Trust this home network**.
4. Tap **Save**. The screen should say **Up to date.** within a few seconds.

## Check it worked

The phone shows **Connected to** followed by your PC's name, and your existing entries appear.

## Notes

- The QR code contains a secret. Don't share screenshots of it. If you think it leaked: on the PC, **Settings → Devices → Rotate token**, then pair your devices again.
- To pair another phone, repeat these steps.
- For syncing away from home, set up [Tailscale](remote-access-tailscale.md) **before** pairing, so the QR code includes your Tailscale address too. (Or pair again afterwards.)
