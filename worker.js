const b64urlToBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

async function verifyAccess(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.TEAM_DOMAIN || !env.POLICY_AUD) return false;
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return false;
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.POLICY_AUD) || payload.exp * 1000 < Date.now()) return false;
  const certs = await (await fetch(`https://${env.TEAM_DOMAIN}/cdn-cgi/access/certs`)).json();
  const jwk = certs.keys.find(k => k.kid === header.kid);
  if (!jwk) return false;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
}

async function upload(request, env) {
  if (!(await verifyAccess(request, env))) return json({ error: 'Not logged in' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }
  const { folder, kind, data } = body;
  if (!/^[a-z0-9-]{1,60}$/.test(folder || '')) return json({ error: 'Invalid folder name' }, 400);
  const file = kind === 'photo' ? 'photo.jpg' : kind === 'video' ? 'motion.mp4' : null;
  if (!file || typeof data !== 'string' || data.length < 100) return json({ error: 'Invalid file' }, 400);
  if (data.length > 20000000) return json({ error: 'File too large (max about 14 MB)' }, 413);

  const path = `looks/${folder}/${file}`;
  const api = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
  const gh = { Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'User-Agent': 'kama-gari-admin', Accept: 'application/vnd.github+json' };

  let sha;
  const existing = await fetch(api, { headers: gh });
  if (existing.ok) sha = (await existing.json()).sha;

  const res = await fetch(api, {
    method: 'PUT',
    headers: { ...gh, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Update ${path}`, content: data, sha })
  });
  if (!res.ok) return json({ error: 'GitHub rejected the upload', detail: (await res.text()).slice(0, 200) }, 502);
  return json({ ok: true, path });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/upload') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      return upload(request, env);
    }
    return env.ASSETS.fetch(request);
  }
};
