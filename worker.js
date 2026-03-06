const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } })
}

async function safeFetch(url, opts) {
  const r = await fetch(url, opts)
  const text = await r.text()
  let data; try { data = JSON.parse(text) } catch(e) { data = { raw: text.slice(0, 300) } }
  return { ok: r.ok, status: r.status, data }
}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)

  // ── CORS preflight ───────────────────────────────────────
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })

  // ── /api/meshy — AI 3D generation proxy ─────────────────
  if (url.pathname === '/api/meshy') {
    try {
      if (request.method === 'POST') {
        let body; try { body = await request.json() } catch(e) { return jsonResp({ error: 'Invalid JSON' }, 400) }
        const { provider = 'tripo3d', action, apiKey, ...params } = body
        if (!apiKey) return jsonResp({ error: 'No API key' }, 400)

        if (provider === 'tripo3d') {
          const tb = action === 'text-to-3d'
            ? { type: 'text_to_model', model_version: 'v2.5-20250123', prompt: params.prompt }
            : { type: 'image_to_model', file: { type: 'jpg', url: params.image_url } }
          const { ok, status, data } = await safeFetch('https://api.tripo3d.ai/v2/openapi/task', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(tb)
          })
          if (!ok || data.code !== 0) return jsonResp({ error: data.message || data.raw || `Tripo3D HTTP ${status}` })
          return jsonResp({ taskId: data.data.task_id })
        }
        if (provider === 'meshy') {
          const mu = action === 'text-to-3d' ? 'https://api.meshy.ai/openapi/v2/text-to-3d' : 'https://api.meshy.ai/openapi/v1/image-to-3d'
          const mb = action === 'text-to-3d'
            ? { mode: 'preview', prompt: params.prompt, art_style: 'realistic', should_remesh: true, topology: 'triangle' }
            : { image_url: params.image_url, enable_pbr: true }
          const { ok, status, data } = await safeFetch(mu, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(mb)
          })
          if (!ok) return jsonResp({ error: data.message || data.raw || `Meshy HTTP ${status}` })
          return jsonResp({ taskId: data.result })
        }
        return jsonResp({ error: `Unknown provider: ${provider}` }, 400)
      }

      if (request.method === 'GET') {
        const q = url.searchParams
        const provider = q.get('provider') || 'tripo3d', apiKey = q.get('apiKey'), taskId = q.get('id'), action = q.get('action') || 'text-to-3d'
        if (!apiKey || !taskId) return jsonResp({ error: 'Missing apiKey or id' }, 400)

        if (provider === 'tripo3d') {
          const { ok, status, data } = await safeFetch(`https://api.tripo3d.ai/v2/openapi/task/${taskId}`, { headers: { 'Authorization': `Bearer ${apiKey}` } })
          if (!ok || data.code !== 0) return jsonResp({ error: data.message || data.raw || `Tripo3D HTTP ${status}` })
          const t = data.data
          const glbUrl = t.output?.model || t.output?.pbr_model || t.output?.base_model || t.output?.rendered_image || null
          return jsonResp({ status: t.status === 'success' ? 'success' : t.status === 'failed' ? 'failed' : 'running', progress: t.progress || 0, glbUrl, error: t.task_error?.message || null, _output: t.output })
        }
        if (provider === 'meshy') {
          const mu = action === 'text-to-3d' ? `https://api.meshy.ai/openapi/v2/text-to-3d/${taskId}` : `https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`
          const { ok, status, data } = await safeFetch(mu, { headers: { 'Authorization': `Bearer ${apiKey}` } })
          if (!ok) return jsonResp({ error: data.message || data.raw || `Meshy HTTP ${status}` })
          return jsonResp({ status: data.status === 'SUCCEEDED' ? 'success' : data.status === 'FAILED' ? 'failed' : 'running', progress: data.progress || 0, glbUrl: data.model_urls?.glb || null, error: data.task_error?.message || null })
        }
        return jsonResp({ error: `Unknown provider: ${provider}` }, 400)
      }
    } catch(e) { return jsonResp({ error: `Worker error: ${e.message}` }, 500) }
  }

  // ── General CORS proxy (?url=...) ────────────────────────
  const target = url.searchParams.get('url')
  if (!target) {
    return new Response(JSON.stringify({ error: 'Missing ?url= parameter' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }
  try {
    const response = await fetch(target, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/csv,text/plain,application/csv,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    })
    const contents = await response.text()
    const headers = {}
    response.headers.forEach((value, key) => { headers[key] = value })
    return new Response(JSON.stringify({ contents, status: response.status, headers }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }
}
