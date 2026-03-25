/**
 * Combined Cloudflare Worker
 * Used by: link-checker.html + user-agent-checker.html
 *
 * Routing:
 *   ?url=&ua=          → UA checker: HEAD with spoofed User-Agent → { status, time }
 *   ?url=&mode=robots  → Fetch /robots.txt → { status, time, body }
 *   ?url=              → Link checker: GET page → { contents }
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function isPrivate(hostname) {
  return (
    hostname === 'localhost' || hostname === '0.0.0.0' ||
    /^127\./.test(hostname) || /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname.endsWith('.internal') || hostname.endsWith('.local')
  );
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get('url');
    const ua   = searchParams.get('ua');
    const mode = searchParams.get('mode');

    if (!targetUrl) return json({ error: 'Missing url parameter' }, 400);

    let parsed;
    try {
      parsed = new URL(targetUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
    } catch { return json({ error: 'Invalid URL' }, 400); }

    if (isPrivate(parsed.hostname)) return json({ error: 'Private URLs not allowed' }, 403);

    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 10000);
    const start = Date.now();

    try {
      // ── UA CHECKER: HEAD request with spoofed User-Agent ──
      if (ua) {
        const res = await fetch(parsed.toString(), {
          method: 'HEAD',
          headers: {
            'User-Agent': ua,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
          redirect: 'manual',
          signal: ctrl.signal,
        });
        clearTimeout(tid);
        const diagHeaders = ['server','cf-ray','x-cache','x-amzn-waf-action','x-powered-by','via'];
        const diag = {};
        diagHeaders.forEach(h => { const v = res.headers.get(h); if (v) diag[h] = v; });
        return json({ status: res.status, time: Date.now() - start, diag });
      }

      // ── ROBOTS.TXT MODE ──
      if (mode === 'robots') {
        const robotsUrl = parsed.origin + '/robots.txt';
        const res = await fetch(robotsUrl, {
          method: 'GET',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Accept': 'text/plain,*/*' },
          signal: ctrl.signal,
        });
        clearTimeout(tid);
        const body = res.ok ? (await res.text()).slice(0, 12000) : null;
        return json({ status: res.status, time: Date.now() - start, body });
      }

      // ── LINK CHECKER: GET full page contents ──
      const res = await fetch(parsed.toString(), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      const contents = await res.text();
      return json({ contents });

    } catch (e) {
      clearTimeout(tid);
      const error = e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR';
      return json({ status: 0, time: Date.now() - start, error });
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
