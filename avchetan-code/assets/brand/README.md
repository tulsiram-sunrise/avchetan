# Avchetan's icon

A capture line (a wave that ends in a dot) over a soft blue-to-violet square. These SVGs are the only sources; every icon file in the repository is made from them.

| File | What it is |
|---|---|
| `icon.svg` | The icon: the desktop app, tray and installer, the classic Android icon, the docs site's favicon |
| `icon-foreground.svg` | Android's adaptive icon foreground and themed (one-colour) icon: the white mark alone, sized to stay inside the safe zone when a phone crops it to a circle or a rounded square |
| `icon-background.svg` | Android's adaptive icon background: the gradient, edge to edge |

Colours: `#3b6fe0` (top left) to `#6a4fd6` (bottom right), and white.

## Changing it

1. Edit the SVGs. Keep the mark's shapes the same in `icon.svg` and `icon-foreground.svg`.
2. From `avchetan-code/`, run `pnpm icons`. It writes:
   - `apps/desktop/src-tauri/icons/` (every size Windows uses, and `icon.ico`)
   - `apps/mobile/assets/` (`icon.png` and the adaptive icon's three layers)
   - `docs/public/` (`favicon.svg` and a 1024 px PNG)
3. For Android, run `npx expo prebuild --platform android --no-install` in `apps/mobile` before building.
4. Commit the SVGs and everything `pnpm icons` wrote.
