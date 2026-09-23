/* 追分計劃 — 進度同步 Worker（選用）
   ---------------------------------------------------------------
   只有兩個動作：
     GET  /state   帶 Authorization: Bearer <金鑰>  → 取回進度 JSON
     PUT  /state   帶同一把金鑰 + JSON body        → 覆寫進度
   金鑰不落地：KV 的鍵是金鑰的 SHA-256，伺服器存不到原始金鑰。
   部署：wrangler deploy（先在 Cloudflare 建一個 KV，綁定名稱 TVJ）
   --------------------------------------------------------------- */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Max-Age': '86400'
};
const J = (obj, status) => new Response(JSON.stringify(obj), {
  status: status || 200,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
});

async function keyId(secret) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('tvj:' + secret));
  return 'state:' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(req.url);
    if (url.pathname !== '/state') return J({ error: 'not found' }, 404);

    const secret = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (secret.length < 12) return J({ error: '金鑰太短，至少 12 個字元' }, 401);

    const id = await keyId(secret);

    if (req.method === 'GET') {
      const v = await env.TVJ.get(id);
      if (!v) return J({ error: 'no state yet' }, 404);
      return new Response(v, { headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });
    }

    if (req.method === 'PUT') {
      const body = await req.text();
      if (body.length > 2_000_000) return J({ error: 'too large' }, 413);
      let parsed;
      try { parsed = JSON.parse(body); } catch { return J({ error: 'bad json' }, 400); }
      if (!parsed || typeof parsed !== 'object') return J({ error: 'bad json' }, 400);
      await env.TVJ.put(id, body);
      return J({ ok: true, updatedAt: parsed.updatedAt || 0 });
    }

    return J({ error: 'method not allowed' }, 405);
  }
};
