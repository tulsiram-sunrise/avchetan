/**
 * Fails if any production dependency (what ships to users; dev tools are not
 * distributed) has a license that is not compatible with
 * AGPL-3.0-or-later (ADR-0018). Run from avchetan-code/: `pnpm licenses:check`.
 */
import { execSync } from 'node:child_process';

/** SPDX identifiers that may be combined with AGPL-3.0-or-later code. */
const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  '0BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'MPL-2.0',
  'Unlicense',
  'CC0-1.0',
  'CC-BY-4.0',
  'BlueOak-1.0.0',
  'Python-2.0',
  'Zlib',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
]);

/** Evaluates simple SPDX expressions: `A OR B`, `A AND B`, parentheses. */
function isAllowed(expression: string): boolean {
  const cleaned = expression.replace(/[()]/g, ' ').trim();
  if (/\sOR\s/.test(cleaned)) return cleaned.split(/\s+OR\s+/).some(isAllowed);
  if (/\sAND\s/.test(cleaned)) return cleaned.split(/\s+AND\s+/).every(isAllowed);
  return ALLOWED.has(cleaned);
}

type LicenseEntry = { name: string; versions: string[] };

const output = execSync('pnpm licenses list --json', {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const byLicense = JSON.parse(output) as Record<string, LicenseEntry[]>;

const problems: string[] = [];
let packages = 0;
for (const [license, entries] of Object.entries(byLicense)) {
  packages += entries.length;
  if (isAllowed(license)) continue;
  for (const entry of entries) {
    problems.push(`${entry.name}@${entry.versions.join(',')}: ${license}`);
  }
}

if (problems.length > 0) {
  process.stderr.write(
    `Dependencies with licenses not cleared for AGPL-3.0 (see ADR-0018):\n  ${problems.join('\n  ')}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `licenses ok: ${packages} packages, ${Object.keys(byLicense).length} license types\n`,
);
