/**
 * Every app icon from the SVG masters in assets/brand/ (assets/brand/README.md):
 * - the desktop app, tray and installer: apps/desktop/src-tauri/icons/
 * - the Android launcher icon (Expo): apps/mobile/assets/
 * - the docs site: docs/public/
 * Run from avchetan-code/: `pnpm icons`, then commit the output. Android needs
 * `npx expo prebuild --platform android --no-install` afterwards to pick them up.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const workspace = resolve(import.meta.dirname, '..', '..');
const brand = join(workspace, 'assets', 'brand');
const desktop = join(workspace, 'apps', 'desktop');

/** Tauri's own CLI, run with this Node (no shell, so no argument is ever re-parsed). */
const tauriCli = join(desktop, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

function tauriIcon(args: string[]): void {
  execFileSync(process.execPath, [tauriCli, 'icon', ...args], { cwd: desktop, stdio: 'inherit' });
}

/** One SVG as a 1024 px PNG. */
function render(svg: string, out: string): void {
  const work = mkdtempSync(join(tmpdir(), 'avchetan-icon-'));
  try {
    tauriIcon([join(brand, svg), '--output', work, '--png', '1024']);
    copyFileSync(join(work, '1024x1024.png'), out);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Desktop: every size Windows needs, plus the .ico the installer and tray use.
const icons = join(desktop, 'src-tauri', 'icons');
tauriIcon([join(brand, 'icon.svg'), '--output', icons]);
// Tauri also writes mobile and Mac App Store sets; the desktop app uses neither.
for (const extra of ['android', 'ios', 'icon.svg'])
  rmSync(join(icons, extra), { recursive: true, force: true });

// Android (Expo): the classic icon and the adaptive icon's layers.
const mobile = join(workspace, 'apps', 'mobile', 'assets');
mkdirSync(mobile, { recursive: true });
render('icon.svg', join(mobile, 'icon.png'));
render('icon-foreground.svg', join(mobile, 'adaptive-foreground.png'));
render('icon-background.svg', join(mobile, 'adaptive-background.png'));
// Android 13's themed icons tint the foreground's shape, so the white mark works as is.
copyFileSync(join(mobile, 'adaptive-foreground.png'), join(mobile, 'adaptive-monochrome.png'));

// Docs site: the SVG itself is the favicon.
const site = join(workspace, '..', 'docs', 'public');
mkdirSync(site, { recursive: true });
copyFileSync(join(brand, 'icon.svg'), join(site, 'favicon.svg'));
render('icon.svg', join(site, 'icon-1024.png'));

process.stdout.write('icons written\n');
