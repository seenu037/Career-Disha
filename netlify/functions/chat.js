// Netlify Function — Groq proxy with Cerebras fallback + Netlify Blobs response cache.
//
// Cache strategy:
//   - The browser computes a canonical SHA-256 of the student's profile fields
//     that drive the LLM output (state, class, stream, top-3 interests/strengths
//     sorted, marks bucket, budget, location, scholarship, pathChoice). Free-text
//     fields like `passion` and exact mark numbers are excluded so similar
//     students collide. The hash is sent as the `x-cache-key` request header.
//   - On cache HIT we return the stored response body without calling Groq
//     (zero tokens consumed). The response carries `x-cache: HIT`.
//   - On cache MISS we forward to Groq, store the body, return `x-cache: MISS`.
//   - Cache failures are non-fatal — we always fall through to Groq if Blobs
//     errors, so a Blobs outage degrades to "no cache" rather than breaking the app.
//
// Fallback: if Groq returns 429 (rate-limit) or 503, the request is automatically
//   retried against Cerebras (CEREBRAS_API_KEY). Same OpenAI-compatible format;
//   model is swapped llama-3.3-70b-versatile → llama-3.3-70b.

const { getStore } = require('@netlify/blobs');

// Swap the model name in a JSON payload string (Groq model → Cerebras model name).
function swapModel(payloadStr, newModel) {
  try { const o = JSON.parse(payloadStr); o.model = newModel; return JSON.stringify(o); }
  catch (_) { return payloadStr; }
}

const CORS_HEADERS = {
  'access-control-allow-origin':  '*',
  'access-control-allow-headers': 'content-type, x-cache-key, x-cache-bypass',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-expose-headers':'x-cache, x-cache-key'
};

function jsonResponse(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign(
      { 'content-type': 'application/json' },
      CORS_HEADERS,
      extraHeaders || {}
    ),
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
}

function getHeader(event, name) {
  if (!event.headers) return undefined;
  return event.headers[name] || event.headers[name.toLowerCase()] || event.headers[name.toUpperCase()];
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: { message: 'Method Not Allowed' } });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, { error: { message: 'GROQ_API_KEY environment variable is not set on the server.' } });
  }

  // ── Cache lookup (best-effort) ─────────────────────────────────────────
  const cacheKey = getHeader(event, 'x-cache-key');
  const bypass   = getHeader(event, 'x-cache-bypass') === '1';
  let store      = null;
  if (cacheKey && !bypass) {
    try {
      store = getStore({ name: 'careerdisha-llm', consistency: 'strong' });
      const cached = await store.get(cacheKey);
      if (cached) {
        return jsonResponse(200, cached, { 'x-cache': 'HIT', 'x-cache-key': cacheKey });
      }
    } catch (err) {
      // Blobs read failed — log and continue to Groq (cache is best-effort).
      console.warn('[chat] cache read failed:', err && err.message);
    }
  }

  // ── Call Groq ──────────────────────────────────────────────────────────
  try {
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
      body:    event.body
    });
    const text = await upstream.text();

    // ── Cerebras fallback on Groq rate-limit or unavailability ──────────────
    if ((upstream.status === 429 || upstream.status === 503) && process.env.CEREBRAS_API_KEY) {
      console.warn('[chat] Groq returned', upstream.status, '— falling back to Cerebras');
      try {
        const cbRes  = await fetch('https://api.cerebras.ai/v1/chat/completions', {
          method:  'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.CEREBRAS_API_KEY },
          body:    swapModel(event.body, 'gpt-oss-120b')
        });
        const cbText = await cbRes.text();
        if (cbRes.ok && cacheKey && !bypass && store) {
          try { await store.set(cacheKey, cbText); } catch (_) {}
        }
        return {
          statusCode: cbRes.status,
          headers: Object.assign({ 'content-type': 'application/json' }, CORS_HEADERS,
            { 'x-cache': cacheKey ? 'MISS' : 'OFF', 'x-cache-key': cacheKey || '', 'x-provider': 'cerebras' }),
          body: cbText
        };
      } catch (cbErr) {
        console.warn('[chat] Cerebras fallback failed:', cbErr && cbErr.message);
        // Fall through and return the original Groq error below
      }
    }

    // Only cache successful, non-empty bodies.
    if (upstream.ok && cacheKey && !bypass && store) {
      try {
        await store.set(cacheKey, text);
      } catch (err) {
        console.warn('[chat] cache write failed:', err && err.message);
      }
    }

    return {
      statusCode: upstream.status,
      headers: Object.assign(
        { 'content-type': 'application/json' },
        CORS_HEADERS,
        { 'x-cache': cacheKey ? (bypass ? 'BYPASS' : 'MISS') : 'OFF', 'x-cache-key': cacheKey || '', 'x-provider': 'groq' }
      ),
      body: text
    };
  } catch (err) {
    return jsonResponse(502, { error: { message: 'Failed to reach Groq API: ' + err.message } });
  }
};
