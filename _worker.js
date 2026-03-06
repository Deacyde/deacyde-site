/**
 * Cloudflare Pages _worker.js
 * Handles /api/meshy proxy (CORS workaround), passes everything else to static assets.
 */

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResp(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS },
    });
}

async function safeFetch(url, opts) {
    const r = await fetch(url, opts);
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { data = { raw: text.slice(0, 300) }; }
    return { ok: r.ok, status: r.status, data };
}

// ── Tripo3D ──────────────────────────────────────────────────
async function tripoCreate(apiKey, body) {
    const { ok, status, data } = await safeFetch(
        'https://platform.tripo3d.ai/v2/openapi/task',
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(body) }
    );
    if (!ok || data.code !== 0) return { error: data.message || data.raw || `Tripo3D HTTP ${status}` };
    return { taskId: data.data.task_id };
}
async function tripoPoll(apiKey, taskId) {
    const { ok, status, data } = await safeFetch(
        `https://platform.tripo3d.ai/v2/openapi/task/${taskId}`,
        { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    if (!ok || data.code !== 0) return { error: data.message || data.raw || `Tripo3D HTTP ${status}` };
    const t = data.data;
    return {
        status:   t.status === 'success' ? 'success' : t.status === 'failed' ? 'failed' : 'running',
        progress: t.progress || 0,
        glbUrl:   t.output?.model || null,
        error:    t.task_error?.message || null,
    };
}

// ── Meshy ────────────────────────────────────────────────────
async function meshyCreate(apiKey, action, params) {
    const url = action === 'text-to-3d'
        ? 'https://api.meshy.ai/openapi/v2/text-to-3d'
        : 'https://api.meshy.ai/openapi/v1/image-to-3d';
    const body = action === 'text-to-3d'
        ? { mode: 'preview', prompt: params.prompt, art_style: 'realistic', should_remesh: true, topology: 'triangle' }
        : { image_url: params.image_url, enable_pbr: true };
    const { ok, status, data } = await safeFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
    });
    if (!ok) return { error: data.message || data.raw || `Meshy HTTP ${status}` };
    return { taskId: data.result };
}
async function meshyPoll(apiKey, taskId, action) {
    const url = action === 'text-to-3d'
        ? `https://api.meshy.ai/openapi/v2/text-to-3d/${taskId}`
        : `https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`;
    const { ok, status, data } = await safeFetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
    if (!ok) return { error: data.message || data.raw || `Meshy HTTP ${status}` };
    return {
        status:   data.status === 'SUCCEEDED' ? 'success' : data.status === 'FAILED' ? 'failed' : 'running',
        progress: data.progress || 0,
        glbUrl:   data.model_urls?.glb || null,
        error:    data.task_error?.message || null,
    };
}

// ── Main export ──────────────────────────────────────────────
export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // Serve static assets for everything except /api/*
        if (!url.pathname.startsWith('/api/')) {
            return env.ASSETS.fetch(request);
        }

        if (url.pathname !== '/api/meshy') {
            return jsonResp({ error: 'Unknown endpoint' }, 404);
        }

        if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

        try {
            if (request.method === 'POST') {
                let body;
                try { body = await request.json(); } catch(e) { return jsonResp({ error: 'Invalid JSON body' }, 400); }
                const { provider = 'tripo3d', action, apiKey, ...params } = body;
                if (!apiKey) return jsonResp({ error: 'No API key' }, 400);
                if (provider === 'tripo3d') {
                    const taskBody = action === 'text-to-3d'
                        ? { type: 'text_to_model', model_version: 'v2.5-20250123', prompt: params.prompt }
                        : { type: 'image_to_model', file: { type: 'jpg', url: params.image_url } };
                    return jsonResp(await tripoCreate(apiKey, taskBody));
                }
                if (provider === 'meshy') return jsonResp(await meshyCreate(apiKey, action, params));
                return jsonResp({ error: `Unknown provider: ${provider}` }, 400);
            }

            if (request.method === 'GET') {
                const provider = url.searchParams.get('provider') || 'tripo3d';
                const apiKey   = url.searchParams.get('apiKey');
                const taskId   = url.searchParams.get('id');
                const action   = url.searchParams.get('action') || 'text-to-3d';
                if (!apiKey || !taskId) return jsonResp({ error: 'Missing apiKey or id' }, 400);
                if (provider === 'tripo3d') return jsonResp(await tripoPoll(apiKey, taskId));
                if (provider === 'meshy')   return jsonResp(await meshyPoll(apiKey, taskId, action));
                return jsonResp({ error: `Unknown provider: ${provider}` }, 400);
            }

            return jsonResp({ error: 'Method not allowed' }, 405);
        } catch(e) {
            return jsonResp({ error: `Worker error: ${e.message}` }, 500);
        }
    }
};
