# Prompt: Add Pi Proxy Toggle to URL Checker App

## Context

The dev.deacyde.com site has a URL checker feature that tests whether URLs return 200, 403, etc. It currently uses a Cloudflare Worker as a CORS proxy to make fetch requests. The problem: insightsoftware.com (and potentially other sites behind Cloudflare/CloudFront WAF) returns **403 to Cloudflare Worker IPs** because they're datacenter IPs.

I've set up a **Raspberry Pi 5 proxy server** on my home network that routes requests through my residential IP — which is whitelisted in insightsoftware's Cloudflare/CloudFront config. The proxy is publicly accessible over HTTPS at:

```
https://pi.deacyde.com/check?url=TARGET_URL
```

This runs through Cloudflare (orange-cloud proxied CNAME → Pi via nginx reverse proxy → Node.js on port 3000). HTTPS is handled by Cloudflare, so there are no mixed-content issues.

## What to Build

Add a **"Pi Proxy"** toggle to the URL checker UI that lets me switch between the existing Cloudflare Worker proxy and the Pi proxy for making URL check requests.

### UI Requirements

1. Add a toggle switch labeled **"Pi Proxy"** near the URL input or in the toolbar/settings area — wherever it makes sense in the existing layout
2. The toggle should be **off by default** (Cloudflare Worker is the default proxy)
3. When toggled on, show a subtle visual indicator (green dot, changed border color, small badge, etc.) so I always know which proxy mode I'm in
4. The toggle state should persist across page reloads (use localStorage)
5. If the Pi proxy is unreachable (timeout or network error), show a toast/notification saying the Pi proxy is unavailable and suggest switching back to the Cloudflare Worker

### Functional Requirements

1. **When Pi Proxy toggle is OFF** (default): URL checks go through the existing Cloudflare Worker proxy — no change to current behavior
2. **When Pi Proxy toggle is ON**: URL checks fetch from:
   ```
   https://pi.deacyde.com/check?url={encodeURIComponent(targetURL)}
   ```
3. The Pi proxy endpoint returns JSON with at minimum the HTTP status code. Parse and display the result the same way the Cloudflare Worker results are displayed
4. Add a **connection test** — either on toggle-on or as a small "test" button next to the toggle. Hit the Pi proxy with a known-good URL (like `https://www.google.com`) to confirm it's reachable before switching over. Show a green checkmark if successful, red X if not
5. **Timeout handling**: Set a 10-second timeout on Pi proxy requests. If it times out, show an error and don't hang the UI
6. Both proxy modes should work with **single URL checks and bulk/batch URL checks** if the app supports batch mode

### Configuration

Store the Pi proxy base URL as a constant or config value so it's easy to change later:

```javascript
const PI_PROXY_BASE = 'https://pi.deacyde.com';
```

### Security Note (for later)

The Pi proxy currently has no authentication. A future update will add an API key. Structure the fetch call so it's easy to add an `x-api-key` header or query parameter later:

```javascript
// Future-proof: easy to add auth header later
const headers = {};
// headers['x-api-key'] = PI_PROXY_API_KEY; // uncomment when auth is added

fetch(`${PI_PROXY_BASE}/check?url=${encodeURIComponent(url)}`, { headers })
```

### Error Handling

- Pi proxy unreachable → toast notification, suggest switching back
- Pi proxy returns unexpected format → show raw response with a warning
- Request timeout (10s) → show timeout error, don't hang the UI

## Pi Proxy API Reference

**Endpoint:** `GET https://pi.deacyde.com/check?url={encoded_url}`

**Example request:**
```
GET https://pi.deacyde.com/check?url=https%3A%2F%2Finsightsoftware.com
```

**Infrastructure:** Cloudflare (HTTPS termination) → nginx (port 80) → Node.js Express (port 3000) on Raspberry Pi 5. The proxy fetches the target URL from a residential IP and returns the result.

## Files to Modify

Look at the existing URL checker component(s) and identify:
1. Where the Cloudflare Worker proxy URL is defined/called — the Pi proxy toggle logic goes adjacent to that
2. Where results are displayed — the Pi proxy results should render identically
3. Where settings/toggles live in the UI — add the Pi Proxy toggle there for consistency

Do not break existing Cloudflare Worker functionality. The toggle switches between the two; both must remain fully functional.
