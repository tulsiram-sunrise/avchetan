# Use your phone away from home (Tailscale)

> Draft — describes planned behavior.

**Goal:** let your phone sync with your Home Hub from anywhere (mobile data, office Wi-Fi), safely and without changing router settings.

Tailscale creates a private, encrypted network between your own devices. It's free for personal use.

1. On the PC: install [Tailscale](https://tailscale.com/download) and sign in.
2. On the phone: install Tailscale from the Play Store and sign in with the **same account**.
3. In Avchetan on the PC: **Settings → Hub → Remote access**. It should show "Tailscale detected: <pc-name>". Click **Include in pairing**.
4. Pair your phone again ([Pair your phone](pair-your-phone.md)) so it learns the Tailscale address. It will use your home Wi-Fi address when at home and Tailscale everywhere else, automatically.

## Check it worked

Turn off Wi-Fi on the phone (use mobile data). Make sure the Tailscale app is connected, add an entry, and watch it reach the PC.

## Notes

- The PC must be on and connected to the internet.
- Avoid "port forwarding" on your router. Tailscale is safer and easier.
