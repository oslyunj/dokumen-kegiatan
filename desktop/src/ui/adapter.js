// Jembatan: menyediakan window.claude.use(...) seperti di claude.ai,
// tetapi datanya disimpan di Google Drive dan email dikirim lewat Gmail API.
(() => {
  const D = window.desktop;
  const mirror = new Map();            // 'koleksi/id' -> data
  const docSubs = new Map();           // path -> Set(fn)
  const colSubs = new Map();           // koleksi -> Set(fn)
  let noAccounts = false;
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const split = p => { const i = p.lastIndexOf('/'); return [p.slice(0, i), p.slice(i + 1)]; };
  const docSnap = p => ({ id: split(p)[1], ref: { path: p }, exists: mirror.has(p), data: () => clone(mirror.get(p)) });
  const colSnap = c => { const docs = [...mirror.keys()].filter(p => split(p)[0] === c).sort().map(docSnap); return { docs, empty: !docs.length, size: docs.length }; };
  const fireDoc = p => docSubs.get(p)?.forEach(fn => { try { fn(docSnap(p)); } catch (e) { console.error(e); } });
  const fireCol = c => colSubs.get(c)?.forEach(fn => { try { fn(colSnap(c)); } catch (e) { console.error(e); } });
  function apply(changed) {
    const cols = new Set();
    for (const [p, v] of Object.entries(changed)) { if (v === null) mirror.delete(p); else mirror.set(p, v); fireDoc(p); cols.add(split(p)[0]); }
    cols.forEach(fireCol);
  }
  const ready = (async () => {
    const s = await D.call('db:init');
    for (const [p, v] of Object.entries(s.docs)) mirror.set(p, v);
    noAccounts = ![...mirror.keys()].some(p => p.startsWith('akun/'));
    D.onChanges(apply);
    window.__dkInfo = { email: s.email, rootUrl: s.rootUrl };
    return true;
  })();
  const sub = (map, key, fn, now) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(fn); setTimeout(() => fn(now()), 0); return () => map.get(key)?.delete(fn); };
  const wrapErr = e => { throw { code: e?.code === 'needs_reauth' ? 'needs_reauth' : (e?.code || 'unavailable'), message: e?.message || String(e) }; };

  const docRef = p => ({
    path: p, id: split(p)[1],
    get: async () => docSnap(p),
    set: data => D.call('db:set', p, clone(data)).catch(wrapErr),
    update: data => D.call('db:update', p, clone(data)).catch(wrapErr),
    delete: () => D.call('db:delete', p).catch(wrapErr),
    onSnapshot: (fn, onErr) => sub(docSubs, p, fn, () => docSnap(p)),
  });
  const query = (c, lim) => ({
    get: async () => { const s = colSnap(c); if (lim) s.docs = s.docs.slice(0, lim); s.empty = !s.docs.length; s.size = s.docs.length; return s; },
    onSnapshot: (fn, onErr) => sub(colSubs, c, fn, () => colSnap(c)),
    limit: n => query(c, n), where: () => query(c, lim), orderBy: () => query(c, lim),
  });
  const db = {
    doc: p => docRef(p),
    collection: c => ({ ...query(c), doc: id => docRef(`${c}/${id || Math.random().toString(36).slice(2, 12)}`), add: async data => { const id = await D.call('db:add', c, clone(data)).catch(wrapErr); return { id, path: `${c}/${id}` }; } }),
  };
  const assets = {
    upload: async (blob, opts = {}) => { const type = opts.type || blob.type || 'application/octet-stream'; return D.call('as:upload', await blob.arrayBuffer(), type, blob.name || opts.name || '').catch(wrapErr); },
    delete: id => D.call('as:delete', id).catch(wrapErr),
    list: async () => ({ assets: [], usage: {} }),
  };
  const downloads = {
    save: async ({ filename, data }) => D.call('dl:save', { filename, data: data instanceof Blob ? await data.arrayBuffer() : data }).catch(wrapErr),
  };
  async function unfile(v) {
    if (v instanceof Blob) return await v.arrayBuffer();
    if (Array.isArray(v)) return Promise.all(v.map(unfile));
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = await unfile(x); return o; }
    return v;
  }
  const mcp = {
    callTool: async (server, tool, input) => D.call('mcp:call', server, tool, await unfile(input)).catch(wrapErr),
    listTools: async () => ({ fileArgs: true, servers: [{ server: 'Gmail' }, { server: 'Google Drive' }, { server: 'Google Calendar' }] }),
  };
  const user = { can: async () => true, canEdit: async () => true, isOwner: async () => noAccounts, id: async () => 'desktop', me: async () => ({ id: 'desktop', name: '', email: window.__dkInfo?.email || null }) };
  // "sample" (AI) di desktop = Gemini
  const sample = async (input, opts = {}) => {
    const prompt = typeof input === 'string' ? input : (input || []).map(m => m.content).join('\n\n');
    const sig = opts.signal;
    if (sig?.aborted) throw { code: 'aborted', message: 'Dihentikan' };
    const imgs = [];
    for (const b of opts.images || []) { const buf = new Uint8Array(await b.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); imgs.push({ mimeType: b.type || 'image/jpeg', data: btoa(bin) }); }
    const job = D.call('ai:generate', prompt, imgs).catch(wrapErr);
    const r = await (sig ? Promise.race([job, new Promise((_, no) => sig.addEventListener('abort', () => no({ code: 'aborted', message: 'Dihentikan' }), { once: true }))]) : job);
    try { opts.onText?.({ text: r.text, delta: r.text }); } catch {}
    return { text: r.text, truncated: !!r.truncated, model: r.model };
  };
  sample.limits = async () => ({ images: true, maxImages: 4 });
  window.__dkAI = { status: () => D.call('ai:status'), setKey: k => D.call('ai:setKey', k), clear: () => D.call('ai:clear') };
  const NS = { db, assets, downloads, mcp, user, sample };
  window.claude = Object.freeze({ use: async name => { if (!NS[name]) return null; try { await ready; } catch (e) { console.error(e); window.__dkInitError = e; return null; } return NS[name]; } });
})();
