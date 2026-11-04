import type { HttpFetch } from '@avchetan/shared';

/**
 * Requests from the app, not from a web page: the HTTP plugin would otherwise send the window's
 * origin, and an installed app's (`http://tauri.localhost`) is one Ollama refuses with 403. An
 * empty Origin makes the plugin leave the header out; that needs its `unsafe-headers` feature
 * (src-tauri/Cargo.toml). docs/architecture/desktop.md#http.
 */
export function withoutOrigin(fetchImpl: HttpFetch): HttpFetch {
  return (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
    headers.set('Origin', '');
    return fetchImpl(input, { ...init, headers });
  };
}
