// Usage: node tooling/perf/measure-desktop.ts [runs]
// Times the demo app's main window over the WebView2 debug port (see tooling/screenshots/README.md
// for starting the demo with it): a reload of the window (its start), then each page's first
// visit after a reload (nothing cached; queries never go stale in the app, so later visits are
// instant) and a later one, until the page stops changing for QUIET_MS. Part of the performance baseline
// (docs/product/finding-and-using-data.md#7-performance-baseline). Dev only, Windows only.
const runs = Number(process.argv[2] ?? '5');
const QUIET_MS = 400;

async function connect(title: string) {
  const pages = (await (await fetch('http://127.0.0.1:9222/json')).json()) as {
    title: string;
    webSocketDebuggerUrl: string;
  }[];
  const page = pages.find((p) => p.title === title);
  if (!page) throw new Error(`no window "${title}"`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  let id = 0;
  const pending = new Map<number, (message: unknown) => void>();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number };
    if (message.id) pending.get(message.id)?.(message);
  });
  const send = (method: string, params = {}) =>
    new Promise<{ result?: { result?: { value?: unknown }; exceptionDetails?: unknown } }>(
      (resolve) => {
        const n = ++id;
        pending.set(n, resolve as (message: unknown) => void);
        ws.send(JSON.stringify({ id: n, method, params }));
      },
    );
  const evaluate = async <T>(expression: string): Promise<T> => {
    const response = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.result?.exceptionDetails) {
      throw new Error(JSON.stringify(response.result.exceptionDetails));
    }
    return response.result?.result?.value as T;
  };
  return { ws, send, evaluate };
}

/** In the page: run `action`, then resolve with the ms until the last DOM change before a quiet gap. */
const timed = (action: string) => `new Promise((resolve) => {
  let last = performance.now();
  const began = last;
  const observer = new MutationObserver(() => { last = performance.now(); });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  ${action};
  const check = () => {
    if (performance.now() - last >= ${QUIET_MS}) { observer.disconnect(); resolve(last - began); }
    else setTimeout(check, 10);
  };
  setTimeout(check, ${QUIET_MS});
})`;

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const main = await connect('Avchetan');
const report = (label: string, samples: number[]) =>
  process.stdout.write(
    `${label.padEnd(28)} ${median(samples).toFixed(0).padStart(6)} ms  (min ${Math.min(...samples).toFixed(0)}, max ${Math.max(...samples).toFixed(0)})\n`,
  );

const views = ['Days', 'Tasks', 'People', 'Review', 'Tags', 'Projects'];
const click = (label: string) =>
  `[...document.querySelectorAll('nav button, header button, button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click()`;

async function reload() {
  await main.send('Page.reload');
  await sleep(100);
  return main.evaluate<number>(`new Promise((resolve) => {
    let last = performance.now();
    const observer = new MutationObserver(() => { last = performance.now(); });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    const check = () => {
      if (performance.now() - last >= ${QUIET_MS} && document.body.innerText.length > 0) { observer.disconnect(); resolve(last); }
      else setTimeout(check, 10);
    };
    check();
  })`);
}

for (const view of views) {
  const cold: number[] = [];
  const warm: number[] = [];
  for (let i = 0; i < runs; i++) {
    await reload();
    cold.push(await main.evaluate<number>(timed(click(view))));
    await main.evaluate(timed(click('Settings')));
    warm.push(await main.evaluate<number>(timed(click(view))));
  }
  report(`page: ${view} (first visit)`, cold);
  report(`page: ${view} (again)`, warm);
}

// The window's start: a reload, from navigation to the Days page settling.
const starts: number[] = [];
for (let i = 0; i < runs; i++) {
  await main.evaluate(timed(click('Days')));
  starts.push(await reload());
}
report('main window start (reload)', starts);
main.ws.close();
