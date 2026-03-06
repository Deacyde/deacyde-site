/**
 * Cloudflare Pages Function — Meshy.ai API proxy
 * Handles CORS so the browser can call Meshy directly.
 *
 * POST /api/meshy  { action, meshyKey, ...params }
 * GET  /api/meshy?action=poll&meshyKey=...&id=...&endpoint=...
 */

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS },
    });
}

async function meshyFetch(url, meshyKey, options = {}) {
    const r = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${meshyKey}`,
            ...(options.headers || {}),
        },
    });
    const data = await r.json();
    if (!r.ok) return { error: data.message || data.error || `HTTP ${r.status}`, status: r.status };
    return data;
}

export async function onRequest(context) {
    const { request } = context;

    // CORS preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS });
    }

    try {
        if (request.method === 'POST') {
            const body = await request.json();
            const { action, meshyKey, ...params } = body;
            if (!meshyKey) return json({ error: 'No Meshy API key provided' }, 400);

            if (action === 'text-to-3d') {
                const data = await meshyFetch(
                    'https://api.meshy.ai/openapi/v2/text-to-3d',
                    meshyKey,
                    { method: 'POST', body: JSON.stringify({
                        mode: 'preview',
                        prompt: params.prompt,
                        art_style: params.art_style || 'realistic',
                        should_remesh: true,
                        topology: 'triangle',
                    }) }
                );
                return json(data);
            }

            if (action === 'image-to-3d') {
                const data = await meshyFetch(
                    'https://api.meshy.ai/openapi/v1/image-to-3d',
                    meshyKey,
                    { method: 'POST', body: JSON.stringify({
                        image_url: params.image_url,
                        enable_pbr: true,
                    }) }
                );
                return json(data);
            }

            return json({ error: 'Unknown action' }, 400);
        }

        if (request.method === 'GET') {
            const url = new URL(request.url);
            const action = url.searchParams.get('action');
            const meshyKey = url.searchParams.get('meshyKey');
            const id = url.searchParams.get('id');
            if (!meshyKey || !id) return json({ error: 'Missing meshyKey or id' }, 400);

            let endpoint;
            if (action === 'poll-text') {
                endpoint = `https://api.meshy.ai/openapi/v2/text-to-3d/${id}`;
            } else if (action === 'poll-image') {
                endpoint = `https://api.meshy.ai/openapi/v1/image-to-3d/${id}`;
            } else {
                return json({ error: 'Unknown poll action' }, 400);
            }

            const data = await meshyFetch(endpoint, meshyKey);
            return json(data);
        }

        return json({ error: 'Method not allowed' }, 405);
    } catch (e) {
        return json({ error: e.message }, 500);
    }
}
