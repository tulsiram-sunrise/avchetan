// node tooling/screenshots/phone.ts <tap TEXT | type TEXT | texts | token | wait TEXT> ...  (pairs, run in order)
// Emulator only (-s emulator-5554), never a phone plugged into this PC.
import { execFileSync } from 'node:child_process';

// biome-ignore lint/suspicious/noUndeclaredEnvVars: a developer tool, not a Turbo task.
const adb = `${process.env.LOCALAPPDATA}\\Android\\Sdk\\platform-tools\\adb.exe`;
const run = (...args) => execFileSync(adb, ['-s', 'emulator-5554', ...args], { encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nodes() {
  const xml = run('exec-out', 'uiautomator', 'dump', '/dev/tty');
  return [...xml.matchAll(/<node [^>]*>/g)].map(([tag]) => {
    const attr = (name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';
    const decode = (s) =>
      s
        .replaceAll('&amp;', '&')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>');
    return {
      text: decode(attr('text')),
      desc: decode(attr('content-desc')),
      bounds: attr('bounds'),
    };
  });
}

async function demoToken() {
  const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
  const dock = pages.find((p) => p.title === 'Avchetan dock');
  const ws = new WebSocket(dock.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  const value = await new Promise((resolve) => {
    ws.addEventListener('message', (e) => resolve(JSON.parse(e.data).result.result.value));
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: "window.__TAURI_INTERNALS__.invoke('secret_get',{name:'hub:server:token'})",
          awaitPromise: true,
          returnByValue: true,
        },
      }),
    );
  });
  ws.close();
  return value;
}

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const action = args[i];
  if (action === 'texts') {
    process.stdout.write(`${nodes()
      .map((n) => n.text || (n.desc && `[${n.desc}]`))
      .filter(Boolean)
      .join(' | ')}
`);
  } else if (action === 'token') {
    run('shell', 'input', 'text', await demoToken());
    process.stdout.write(`${'token typed'}
`);
  } else if (action === 'back') {
    run('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  } else if (action === 'sleep') {
    await sleep(Number(args[++i]));
  } else {
    const value = args[++i];
    if (action === 'type') {
      run('shell', 'input', 'text', value.replaceAll(' ', '%s'));
    } else if (action === 'tap' || action === 'wait' || action === 'tapdesc') {
      let node: { text: string; desc: string; bounds: string } | undefined;
      for (let tries = 0; tries < (action === 'wait' ? 90 : 5); tries++) {
        node = nodes().find((n) =>
          action === 'tapdesc' ? n.desc === value : n.text === value || n.desc === value,
        );
        if (node) break;
        await sleep(1000);
      }
      if (!node) throw new Error(`no element "${value}"`);
      if (action !== 'wait') {
        const [x1, y1, x2, y2] = node.bounds.match(/\d+/g).map(Number);
        run(
          'shell',
          'input',
          'tap',
          String(Math.round((x1 + x2) / 2)),
          String(Math.round((y1 + y2) / 2)),
        );
      }
      process.stdout.write(`${`${action} ${value}`}
`);
    }
    await sleep(700);
  }
}
