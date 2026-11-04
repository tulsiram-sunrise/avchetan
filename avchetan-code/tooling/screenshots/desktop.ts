// Usage: node tooling/screenshots/desktop.ts <window title> <js to run first, may be ''> [out.png] [width] [height]
// Captures a fixed-size view of a demo window, with this PC's own addresses replaced by made-up
// ones, so nothing in a published screenshot identifies a real network.
import { writeFileSync } from 'node:fs';

const [title, script, out, width = '1000', height = '720'] = process.argv.slice(2);
const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = pages.find((p) => p.title === title);
if (!page) throw new Error(`no window "${title}"`);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  pending.get(message.id)?.(message);
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.result?.exceptionDetails)
    throw new Error(JSON.stringify(result.result.exceptionDetails));
  return result.result?.result?.value;
};

if (script)
  process.stdout.write(`${JSON.stringify(await evaluate(script))}
`);

if (out) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: Number(width),
    height: Number(height),
    deviceScaleFactor: 1.5,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 600));
  // Made-up addresses in place of this PC's real ones; QR codes are blurred (they hold a token).
  const leaks = await evaluate(`(() => {
    const swaps = [
      [/\\b100\\.(6[4-9]|[7-9]\\d|1[01]\\d|12[0-7])\\.\\d{1,3}\\.\\d{1,3}\\b/g, '100.101.102.103'],
      [/\\b192\\.168\\.\\d{1,3}\\.\\d{1,3}\\b/g, '192.168.1.20'],
      [/\\b10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b/g, '192.168.1.20'],
      [/[A-Za-z0-9-]+\\.[A-Za-z0-9-]+\\.ts\\.net/g, 'my-pc.tailnet.ts.net'],
      [/“[^”]+”/g, '“Home Wi-Fi”'],
    ];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      let text = node.nodeValue;
      for (const [pattern, replacement] of swaps) text = text.replace(pattern, replacement);
      if (text !== node.nodeValue) node.nodeValue = text;
    }
    for (const field of document.querySelectorAll('input, textarea')) {
      let text = field.value;
      for (const [pattern, replacement] of swaps) text = text.replace(pattern, replacement);
      field.value = text;
    }
    for (const qr of document.querySelectorAll('[aria-label="Pairing code"]')) qr.style.filter = 'blur(6px)';
    return document.body.innerText.match(/\\b(100\\.95\\.|192\\.168\\.(?!1\\.20)|Krishna)/g) ?? [];
  })()`);
  if (leaks.length) throw new Error(`still visible: ${leaks.join(', ')}`);
  const image = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(image.result.data, 'base64'));
  await send('Emulation.clearDeviceMetricsOverride');
  process.stdout.write(`${`saved ${out}`}
`);
}
ws.close();
