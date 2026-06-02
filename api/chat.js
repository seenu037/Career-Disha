// Vercel Serverless Function — Groq proxy with Cerebras fallback + optional Vercel KV cache.
//
// Mirrors netlify/functions/chat.js so the app runs on BOTH platforms. The browser always
// calls /api/chat: on Vercel this file handles it; on Netlify a rewrite in netlify.toml maps
// /api/chat -> /.netlify/functions/chat.
//
// Fallback: if Groq returns 429 (rate-limit) or 503, the request is retried against the
//   Cerebras API (CEREBRAS_API_KEY env var). Cerebras uses the same OpenAI-compatible format;
//   only the model name is swapped (llama-3.3-70b-versatile → llama-3.3-70b).
//
// Caching (best-effort, like the Netlify version):
//   - The browser sends a canonical profile hash as the `x-cache-key` header.
//   - If Vercel KV is configured (KV_REST_API_URL present), a cache HIT returns the stored
//     body with `x-cache: HIT` and zero tokens; a MISS forwards to Groq (or Cerebras) and stores it.
//   - If KV isn't configured or errors, we silently fall through (cache is optional).

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-cache-key, x-cache-bypass',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-expose-headers': 'x-cache, x-cache-key'
};

function applyCors(res) {
  Object.keys(CORS_HEADERS).forEach(function (k) { res.setHeader(k, CORS_HEADERS[k]); });
}

// Swap the model name in a JSON payload string (Groq → Cerebras naming).
function swapModel(payloadStr, newModel) {
  try { var o = JSON.parse(payloadStr); o.model = newModel; return JSON.stringify(o); }
  catch (_) { return payloadStr; }
}

// Lazy KV client — only when Vercel KV is actually configured for the project.
async function getKV() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  try {
    var mod = await import('@vercel/kv');
    return mod.kv || null;
  } catch (err) {
    console.warn('[chat] @vercel/kv unavailable:', err && err.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  applyCors(res);
  res.setHeader('content-type', 'application/json');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).send(JSON.stringify({ error: { message: 'Method Not Allowed' } })); return; }

  var apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).send(JSON.stringify({ error: { message: 'GROQ_API_KEY environment variable is not set on the server.' } }));
    return;
  }

  var cacheKey = req.headers['x-cache-key'];
  var bypass = req.headers['x-cache-bypass'] === '1';

  // ── Cache lookup (best-effort) ──────────────────────────────────────────
  var kv = null;
  if (cacheKey && !bypass) {
    kv = await getKV();
    if (kv) {
      try {
        var cached = await kv.get(cacheKey);
        if (cached && cached.body) {
          res.setHeader('x-cache', 'HIT');
          res.setHeader('x-cache-key', cacheKey);
          res.status(200).send(cached.body);
          return;
        }
      } catch (err) {
        console.warn('[chat] KV read failed:', err && err.message);
      }
    }
  }

  // ── Forward to Groq ─────────────────────────────────────────────────────
  // Vercel parses JSON bodies into req.body; re-stringify to forward verbatim.
  var payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  try {
    var upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
      body: payload
    });
    var text = await upstream.text();

    // ── Cerebras fallback on Groq rate-limit or unavailability ──────────────
    if ((upstream.status === 429 || upstream.status === 503) && process.env.CEREBRAS_API_KEY) {
      console.warn('[chat] Groq returned', upstream.status, '— falling back to Cerebras');
      try {
        var cbRes = await fetch('https://api.cerebras.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.CEREBRAS_API_KEY },
          body: swapModel(payload, 'gpt-oss-120b')
        });
        var cbText = await cbRes.text();
        if (cbRes.ok && cacheKey && !bypass && kv) {
          try { await kv.set(cacheKey, { body: cbText }, { ex: 60 * 60 * 24 * 30 }); } catch (_) {}
        }
        res.setHeader('x-cache', cacheKey ? 'MISS' : 'OFF');
        res.setHeader('x-cache-key', cacheKey || '');
        res.setHeader('x-provider', 'cerebras');
        res.status(cbRes.status).send(cbText);
        return;
      } catch (cbErr) {
        console.warn('[chat] Cerebras fallback failed:', cbErr && cbErr.message);
        // Fall through and return the original Groq error below
      }
    }

    if (upstream.ok && cacheKey && !bypass && kv) {
      try {
        await kv.set(cacheKey, { body: text }, { ex: 60 * 60 * 24 * 30 }); // 30-day TTL
      } catch (err) {
        console.warn('[chat] KV write failed:', err && err.message);
      }
    }

    res.setHeader('x-cache', cacheKey ? (bypass ? 'BYPASS' : (kv ? 'MISS' : 'OFF')) : 'OFF');
    res.setHeader('x-cache-key', cacheKey || '');
    res.setHeader('x-provider', 'groq');
    res.status(upstream.status).send(text);
  } catch (err) {
    res.status(502).send(JSON.stringify({ error: { message: 'Failed to reach Groq API: ' + err.message } }));
  }
};
