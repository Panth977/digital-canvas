/**
 * Native shell only: the WebView's origin (`capacitor://localhost` on iOS,
 * `https://localhost` on Android) is not in the Cloud Functions' CORS list, so
 * calls to our callables go through CapacitorHttp (native networking, no CORS).
 * Everything else keeps the WebView's own fetch — Drive uploads and downloads,
 * identitytoolkit and securetoken all allow any origin. Global CapacitorHttp
 * patching stays off (capacitor.config.ts).
 */

/** Requests that must skip WebView CORS: Firebase callables (pure; tested). */
export function isFunctionsUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  // <region>-<project>.cloudfunctions.net/<name> (v1 URLs, which the Firebase SDK uses for v2 too)
  // and <name>-<hash>-<region>.a.run.app (Cloud Run URLs of v2 functions).
  return u.hostname.endsWith('.cloudfunctions.net') || u.hostname.endsWith('.run.app');
}

let installed = false;

export function installNativeFetch(): void {
  if (installed) return;
  installed = true;
  const webFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isFunctionsUrl(url)) return webFetch(input, init);
    const { CapacitorHttp } = await import('@capacitor/core');
    const req = input instanceof Request ? input : null;
    const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? req?.headers).forEach((v, k) => (headers[k] = v));
    let body: unknown = init?.body ?? (req && method !== 'GET' ? await req.text() : undefined);
    if (typeof body === 'string' && /json/i.test(headers['content-type'] ?? '')) {
      try { body = JSON.parse(body); } catch { /* send as text */ }
    }
    let r;
    try {
      r = await CapacitorHttp.request({ url, method, headers, data: body, responseType: 'text' });
    } catch (e) {
      // Same shape as a browser network failure.
      throw new TypeError(`Network request failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data ?? null);
    return new Response(r.status === 204 ? null : text, { status: r.status, headers: r.headers });
  };
}
