# Use your phone away from home (Tailscale)

**Goal:** let your phone sync with your Home Hub from anywhere (mobile data, office Wi-Fi), safely and without changing router settings.

Tailscale creates a private, encrypted network between your own devices. It's free for personal use. Avchetan sends the sync token over Tailscale without `https://`, because Tailscale already encrypts everything between your devices.

1. On the PC: install [Tailscale](https://tailscale.com/download) and sign in.
2. On the phone: install **Tailscale** from the Play Store and sign in with the **same account**. Turn it on.
3. On the PC, let Tailscale devices reach the hub. Open PowerShell **as administrator** and run:

   ```powershell
   New-NetFirewallRule -DisplayName "Avchetan hub (Tailscale)" -Direction Inbound -Protocol TCP -LocalPort 8787 -RemoteAddress 100.64.0.0/10 -Action Allow
   ```

   It allows only the hub's port, and only from Tailscale addresses (`100.64.0.0/10`), whatever network the PC is on.
4. Pair your phone again ([Pair your phone](pair-your-phone.md)), so it learns the PC's Tailscale address as well. The hub adds it to the pairing code by itself while Tailscale is running. The phone uses your home Wi-Fi address when at home and Tailscale everywhere else, automatically.

## Check it worked

1. On the phone, turn off Wi-Fi so it uses mobile data, and check that the Tailscale app shows **Connected**.
2. Add an entry: `Bought groceries on the way home`.
3. Within about a minute it appears on the PC.

## Notes

- The PC must be on, with the hub running and connected to the internet.
- If the phone still can't reach the hub away from home, open the Tailscale app on the phone and check that the PC is listed and online.
- Avoid "port forwarding" on your router. Tailscale is safer and easier.
- The planned installer will find Tailscale by itself and add the firewall rule for you.
