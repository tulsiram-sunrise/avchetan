# Use your phone away from home (Tailscale)

**Goal:** let your phone sync with your Home Hub from anywhere (mobile data, office Wi-Fi), safely and without changing router settings.

Tailscale creates a private, encrypted network between your own devices. It's free for personal use. Avchetan sends the sync token over Tailscale without `https://`, because Tailscale already encrypts everything between your devices.

1. On the PC: install [Tailscale](https://tailscale.com/download) and sign in.
2. On the phone: install **Tailscale** from the Play Store and sign in with the **same account**. Turn it on.
3. On the PC, let Tailscale devices reach the hub. In Avchetan's **Settings → Home Hub on this PC**, the checklist now says **Away from home: Windows' firewall blocks Tailscale**: click **Allow phones to connect**, then **Yes** when Windows asks. The line then says **Away from home: Tailscale is on**, with the PC's Tailscale address.

   For a hub you [run from a terminal](setup-home-hub.md#run-the-hub-from-a-terminal-instead) or with Docker, open PowerShell **as administrator** and run instead:

   ```powershell
   New-NetFirewallRule -DisplayName "Avchetan hub (Tailscale)" -Direction Inbound -Protocol TCP -LocalPort 8787 -RemoteAddress 100.64.0.0/10 -Action Allow
   ```

   It allows only the hub's port, and only from Tailscale addresses (`100.64.0.0/10`), whatever network the PC is on.
4. Pair your phone again ([Pair your phone](pair-your-phone.md)), so it learns the PC's Tailscale address as well. The hub adds it to the pairing code by itself while Tailscale is running. The phone uses your home Wi-Fi address when at home and Tailscale everywhere else, automatically.

   Or add it by hand: click the Tailscale icon in the PC's taskbar and copy **This device**'s address (`100.x.y.z`). On the phone, open **More → Sync**, enter `http://100.x.y.z:8787` as **Second address**, and tap **Save**. The saved token stays.

## Check it worked

1. On the phone, turn off Wi-Fi so it uses mobile data, and check that the Tailscale app shows **Connected**.
2. Add an entry: `Bought groceries on the way home`.
3. Within about a minute it appears on the PC.

## Notes

- The PC must be on, with the hub running and connected to the internet.
- If the phone still can't reach the hub away from home, open the Tailscale app on the phone and check that the PC is listed and online.
- Avoid "port forwarding" on your router. Tailscale is safer and easier.
