exports.handler = async (event) => {
  const { lat, lon, dist } = event.queryStringParameters || {};
  if (!lat || !lon || !dist) {
    return { statusCode: 400, body: 'Missing lat, lon, or dist' };
  }

  const url = `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`;

  try {
    const res = await fetch(url);
    const data = await res.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: data,
    };
  } catch (err) {
    return { statusCode: 502, body: `Proxy error: ${err.message}` };
  }
};
