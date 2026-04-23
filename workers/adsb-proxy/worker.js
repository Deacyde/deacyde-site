const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const lat  = url.searchParams.get('lat');
    const lon  = url.searchParams.get('lon');
    const dist = url.searchParams.get('dist');

    if (!lat || !lon || !dist) {
      return new Response('Missing lat, lon, or dist', { status: 400, headers: CORS });
    }

    const upstream = `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`;

    try {
      const res = await fetch(upstream);
      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    } catch (err) {
      return new Response(`Proxy error: ${err.message}`, { status: 502, headers: CORS });
    }
  },
};
