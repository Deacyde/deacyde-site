/**
 * Cloudflare Worker: ua-checker
 * Deploy as: ua-checker.deacyde.workers.dev
 *
 * Accepts:
 *   ?url=<encoded>&ua=<encoded>          -> HEAD request, returns { status, time }
 *   ?url=<encoded>&mode=robots           -> GET /robots.txt, returns { status, time, body }
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// Blocked private/internal hostnames
function isPrivate(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local')
  );
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get('url');
    const ua = searchParams.get('ua') || 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
    const mode = searchParams.get('mode') || 'check';

    if (!targetUrl) {
      return json({ error: 'Missing url parameter' }, 400);
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
    } catch {
      return json({ error: 'Invalid URL' }, 400);
    }

    if (isPrivate(parsed.hostname)) {
      return json({ error: 'Private/internal URLs not allowed' }, 403);
    }

    const start = Date.now();
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10000);

    try {
      if (mode === 'robots') {
        const robotsUrl = parsed.origin + '/robots.txt';
        const res = await fetch(robotsUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            'Accept': 'text/plain, text/html, */*',
          },
          signal: controller.signal,
        });
        clearTimeout(tid);
        const time = Date.now() - start;
        const body = res.ok ? (await res.text()).slice(0, 12000) : null;
        return json({ status: res.status, time, body });
      } else {
        const res = await fetch(parsed.toString(), {
          method: 'HEAD',
          headers: {
            'User-Agent': ua,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
          redirect: 'manual',
          signal: controller.signal,
        });
        clearTimeout(tid);
        const time = Date.now() - start;
        return json({ status: res.status, time });
      }
    } catch (e) {
      clearTimeout(tid);
      const time = Date.now() - start;
      const error = e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR';
      return json({ status: 0, time, error });
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
