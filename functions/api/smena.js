/**
 * /api/smena — хранилище передачи смен в Cloudflare KV.
 *
 * KV namespace привязывается к Pages-проекту под именем SMENA_KV.
 * Ключ один: "state".
 *
 * GET  -> { rev, state, at }
 * PUT  { rev, state, force } -> { rev, at }  |  409, если rev устарел
 *
 * Защита от затирания (409) обязательна: сменой пользуются два менеджера
 * одновременно, без проверки rev правки молча теряются.
 */
const KEY = 'state';
const HEAD = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEAD });
}

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.SMENA_KV;

  if (!kv) {
    // Привязка не настроена — приложение само уйдёт в локальный режим.
    return json({ error: 'KV binding SMENA_KV is not configured' }, 503);
  }

  if (request.method === 'GET') {
    const raw = await kv.get(KEY);
    if (!raw) return json({ rev: 0, state: null, at: 0 });
    let doc;
    try { doc = JSON.parse(raw); } catch (e) { return json({ rev: 0, state: null, at: 0 }); }
    return json({ rev: doc.rev || 0, state: doc.state || null, at: doc.at || 0 });
  }

  if (request.method === 'PUT') {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
    if (!body || typeof body.state !== 'object' || body.state === null) {
      return json({ error: 'state required' }, 400);
    }

    const raw = await kv.get(KEY);
    let curRev = 0;
    if (raw) {
      try { curRev = JSON.parse(raw).rev || 0; } catch (e) { curRev = 0; }
    }

    if (!body.force && Number(body.rev || 0) !== curRev) {
      return json({ error: 'conflict', rev: curRev }, 409);
    }

    const doc = { rev: curRev + 1, state: body.state, at: Date.now() };
    await kv.put(KEY, JSON.stringify(doc));
    return json({ rev: doc.rev, at: doc.at });
  }

  return json({ error: 'method not allowed' }, 405);
}
