// Server Google tiruan (OAuth, Drive v3, Gmail v1) untuk pengujian otomatis.
const http = require('http');
const crypto = require('crypto');
const files = new Map(), mails = [], drafts = [], events = new Map(), gemini = [];
let clock = 0;
const now = () => new Date(clock = Math.max(Date.now(), clock + 1)).toISOString();
const id = () => 'F' + crypto.randomBytes(12).toString('hex');
const EMAIL = process.env.MOCK_EMAIL || 'mm.febunj@gmail.com';
const tokens = new Set();

function view(f) {
  const { content, ...m } = f;
  return { ...m, webViewLink: f.mimeType === 'application/vnd.google-apps.folder' ? `https://drive.google.com/drive/folders/${f.id}` : `https://drive.google.com/file/d/${f.id}/view`, owners: [{ emailAddress: EMAIL }], capabilities: { canAddChildren: true } };
}
function match(f, q) {
  const ap = /appProperties has \{ key='(.+?)' and value='(.+?)' \}/.exec(q); if (ap && (f.appProperties || {})[ap[1]] !== ap[2]) return false;
  const par = /'([^']+)' in parents/.exec(q); if (par && !(f.parents || []).includes(par[1])) return false;
  if (/trashed=false/.test(q) && f.trashed) return false;
  const mt = /mimeType='([^']+)'/.exec(q); if (mt && f.mimeType !== mt[1]) return false;
  const mod = /modifiedTime > '([^']+)'/.exec(q); if (mod && !(f.modifiedTime > mod[1])) return false;
  return true;
}
function create(meta, content, type) {
  const f = { id: id(), name: meta.name || 'Tanpa judul', mimeType: meta.mimeType || type || 'application/octet-stream', parents: meta.parents || ['root'], appProperties: meta.appProperties || {}, description: meta.description, createdTime: now(), trashed: false, content: content || null, contentType: type || null };
  f.modifiedTime = f.createdTime; files.set(f.id, f); return f;
}
function parseMultipart(buf, ctype) {
  const b = /boundary=([^;]+)/.exec(ctype)[1].replace(/"/g, '');
  const parts = []; let s = buf.indexOf('--' + b);
  while (s >= 0) {
    const n = buf.indexOf('--' + b, s + b.length + 2); if (n < 0) break;
    const part = buf.slice(s + b.length + 4, n - 2); const h = part.indexOf('\r\n\r\n');
    parts.push({ headers: part.slice(0, h).toString(), body: part.slice(h + 4) }); s = n;
  }
  return parts;
}
const resumable = new Map();
const srv = http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    const body = Buffer.concat(chunks), u = new URL(req.url, 'http://x'), p = u.pathname, q = u.searchParams;
    const json = (o, st = 200, h = {}) => { res.writeHead(st, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
    const auth = () => { const t = (req.headers.authorization || '').replace('Bearer ', ''); if (!tokens.has(t)) { json({ error: { message: 'Invalid Credentials' } }, 401); return false; } return true; };
    try {
      if (p === '/o/oauth2/v2/auth') { res.writeHead(302, { Location: `${q.get('redirect_uri')}/?code=KODE-${crypto.randomBytes(4).toString('hex')}&state=${q.get('state')}` }); res.end(); return; }
      if (p === '/token') { const f = new URLSearchParams(body.toString()); const at = 'AT-' + crypto.randomBytes(6).toString('hex'); tokens.add(at); return json({ access_token: at, expires_in: 3600, ...(f.get('grant_type') === 'authorization_code' ? { refresh_token: 'RT-' + crypto.randomBytes(6).toString('hex') } : {}) }); }
      if (p === '/revoke') return json({});
      if (p.startsWith('/gemini/')) {
        if (!['AIzaUJI-kunci-tiruan-1234567890', 'AQ.Ab8uji-KunciFormatBaru_12345678901234567890'].includes(req.headers['x-goog-api-key'])) return json({ error: { message: 'API key not valid. Please pass a valid API key.' } }, 400);
        if (p === '/gemini/models') return json({ models: [
          { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
          { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] } ] });
        const mm = /^\/gemini\/models\/(.+):generateContent$/.exec(p);
        if (mm && process.env.MOCK_BUSY && decodeURIComponent(mm[1]) === 'gemini-2.5-flash') { gemini.push({ model: 'gemini-2.5-flash', busy: true }); return json({ error: { code: 503, message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.', status: 'UNAVAILABLE' } }, 503); }
        if (mm) { const parts = JSON.parse(body.toString()).contents[0].parts, prompt = parts[0].text; gemini.push({ model: decodeURIComponent(mm[1]), prompt, foto: parts.filter(x => x.inlineData).map(x => x.inlineData.mimeType + ':' + Math.round(x.inlineData.data.length * 0.75 / 1024) + 'KB') });
          const judul = (/Nama kegiatan: (.+)/.exec(prompt) || [])[1] || 'Kegiatan';
          return json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: `JUDUL: **Prodi MM FEB UNJ Gelar ${judul}**\n\nJAKARTA – Program Studi Magister Manajemen menggelar ${judul}.\n\nKegiatan dipimpin [lengkapi: nama pimpinan].` }] } }] }); }
      }
      if (p === '/__state') return json({ gemini, events: [...events.values()], files: [...files.values()].map(f => ({ ...view(f), size: f.content ? f.content.length : 0, text: f.content && /json|html|csv|text/.test(f.contentType || '') ? f.content.toString().slice(0, 300) : undefined })), mails, drafts });
      if (!auth()) return;
      if (p === '/userinfo') return json({ email: EMAIL });
      // ----- Drive -----
      let m;
      if (p === '/drive/v3/files' && req.method === 'GET') { const L = [...files.values()].filter(f => match(f, q.get('q') || '')).sort((a, b) => a.createdTime.localeCompare(b.createdTime)); return json({ files: L.map(view) }); }
      if (p === '/drive/v3/files' && req.method === 'POST') return json(view(create(JSON.parse(body.toString()))));
      if ((m = /^\/drive\/v3\/files\/([^/]+)$/.exec(p))) {
        const f = files.get(m[1]); if (!f) return json({ error: { message: 'File not found' } }, 404);
        if (req.method === 'GET' && q.get('alt') === 'media') { res.writeHead(200, { 'Content-Type': f.contentType || 'application/octet-stream' }); res.end(f.content || Buffer.alloc(0)); return; }
        if (req.method === 'GET') return json(view(f));
        if (req.method === 'PATCH') {
          const meta = body.length ? JSON.parse(body.toString()) : {};
          if (meta.name) f.name = meta.name; if (meta.trashed != null) f.trashed = meta.trashed; if (meta.description != null) f.description = meta.description;
          if (q.get('addParents')) { const rm = (q.get('removeParents') || '').split(','); f.parents = [...f.parents.filter(x => !rm.includes(x)), q.get('addParents')]; }
          f.modifiedTime = now(); return json(view(f));
        }
      }
      if (p === '/upload/drive/v3/files' && q.get('uploadType') === 'multipart') { const [a, b] = parseMultipart(body, req.headers['content-type']); const t = /Content-Type: ([^\r\n]+)/i.exec(b.headers)[1]; return json(view(create(JSON.parse(a.body.toString()), b.body, t))); }
      if (p === '/upload/drive/v3/files' && q.get('uploadType') === 'resumable') { const sid = id(); resumable.set(sid, { meta: JSON.parse(body.toString()), type: req.headers['x-upload-content-type'] }); res.writeHead(200, { Location: `http://${req.headers.host}/upload/resumable/${sid}` }); res.end(); return; }
      if ((m = /^\/upload\/resumable\/(.+)$/.exec(p))) { const r = resumable.get(m[1]); return json(view(create(r.meta, body, r.type))); }
      if ((m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(p)) && req.method === 'PATCH') { const f = files.get(m[1]); f.content = body; f.contentType = req.headers['content-type']; f.modifiedTime = now(); return json({ id: f.id, modifiedTime: f.modifiedTime }); }
      // ----- Calendar -----
      if (p === '/calendar/v3/calendars/primary/events' && req.method === 'POST') { const ev = { ...JSON.parse(body.toString()), id: 'ev' + crypto.randomBytes(5).toString('hex'), sendUpdates: q.get('sendUpdates') }; ev.htmlLink = 'https://www.google.com/calendar/event?eid=' + ev.id; events.set(ev.id, ev); return json(ev); }
      if ((m = /^\/calendar\/v3\/calendars\/primary\/events\/([^/]+)$/.exec(p))) {
        const ev = events.get(m[1]); if (!ev) return json({ error: { message: 'Not Found' } }, 404);
        if (req.method === 'GET') return json(ev);
        if (req.method === 'PATCH') { Object.assign(ev, JSON.parse(body.toString()), { sendUpdates: q.get('sendUpdates') }); return json(ev); }
        if (req.method === 'DELETE') { events.delete(m[1]); res.writeHead(204); res.end(); return; }
      }
      // ----- Gmail -----
      if (p === '/upload/gmail/v1/users/me/messages/send') { const it = { id: 'M' + mails.length, threadId: 'T' + mails.length, raw: body.toString() }; mails.push(it); return json({ id: it.id, threadId: it.threadId }); }
      if (p === '/upload/gmail/v1/users/me/drafts') { const it = { id: 'D' + drafts.length, raw: body.toString() }; drafts.push(it); return json({ id: it.id, message: { id: 'MD' + drafts.length } }); }
      json({ error: { message: 'tidak dikenal ' + req.method + ' ' + p } }, 404);
    } catch (e) { console.error(e); json({ error: { message: String(e) } }, 500); }
  });
});
srv.listen(Number(process.env.MOCK_PORT || 47123), '127.0.0.1', () => console.log('mock google on', srv.address().port));
