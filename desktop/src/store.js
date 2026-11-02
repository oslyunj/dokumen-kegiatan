// Penyimpanan data bersama di Google Drive (akun yang masuk, mis. mm.febunj@gmail.com).
// Struktur di Drive:
//   Dokumen Kegiatan S2 MM/            <- folder arsip (folder kegiatan, Google Docs, dll.)
//     _data aplikasi (jangan diubah)/  <- satu berkas JSON per dokumen database
//     _aset aplikasi (jangan diubah)/  <- berkas unggahan (PDF, foto, logo)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FOLDER = 'application/vnd.google-apps.folder';
const ROOT_NAME = 'Dokumen Kegiatan S2 MM';

class Store {
  constructor(google, cacheDir, emit) {
    this.g = google; this.cacheDir = cacheDir; this.emit = emit;
    this.docs = new Map();           // path -> { fileId, data, mt }
    this.root = null; this.dataF = null; this.asetF = null;
    this.lastPoll = null; this.ready = null; this.locks = new Map(); this.polling = false;
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  // ---------- inisialisasi ----------
  init() { if (!this.ready) this.ready = this._init().catch(e => { this.ready = null; throw e; }); return this.ready; }
  async _init() {
    const find = async role => (await this.g.driveFiles(`appProperties has { key='dk' and value='${role}' } and trashed=false and mimeType='${FOLDER}'`, 'id,name,webViewLink,createdTime,parents', { orderBy: 'createdTime' }))[0];
    this.root = await find('root') || await this.g.driveCreate({ name: ROOT_NAME, mimeType: FOLDER, appProperties: { dk: 'root' }, description: 'Arsip aplikasi Dokumen Kegiatan - S2 Magister Manajemen FEB UNJ. Folder "_data aplikasi" dan "_aset aplikasi" dipakai aplikasi; jangan diubah atau dihapus.' });
    this.dataF = await find('data') || await this.g.driveCreate({ name: '_data aplikasi (jangan diubah)', mimeType: FOLDER, parents: [this.root.id], appProperties: { dk: 'data' } });
    this.asetF = await find('aset') || await this.g.driveCreate({ name: '_aset aplikasi (jangan diubah)', mimeType: FOLDER, parents: [this.root.id], appProperties: { dk: 'aset' } });
    const started = new Date(Date.now() - 5000).toISOString();
    const files = await this.g.driveFiles(`'${this.dataF.id}' in parents and trashed=false`);
    await pool(files, 8, async f => { const p = pathOf(f); if (!p) return; this.docs.set(p, { fileId: f.id, mt: f.modifiedTime, data: await this._readJson(f.id) }); });
    this.lastPoll = started;
    if (!this.docs.has('pengaturan/drive')) {
      await this.set('pengaturan/drive', { rootId: this.root.id, rootUrl: this.root.webViewLink || `https://drive.google.com/drive/folders/${this.root.id}`, rootTitle: this.root.name || ROOT_NAME, akun: this.g.email || '' });
    }
    return this.snapshot();
  }
  snapshot() { const o = {}; for (const [p, v] of this.docs) o[p] = v.data; return { docs: o, email: this.g.email, rootUrl: this.root?.webViewLink || '' }; }
  async _readJson(id) { const r = await this.g.driveMedia(id); try { return JSON.parse(await r.text()); } catch { return {}; } }
  // ---------- tarik perubahan dari komputer lain ----------
  async poll() {
    if (!this.dataF || this.polling) return;
    this.polling = true;
    try {
      const since = this.lastPoll, now = new Date(Date.now() - 5000).toISOString();
      const files = await this.g.driveFiles(`'${this.dataF.id}' in parents and modifiedTime > '${since}'`);
      const changed = {};
      await pool(files, 6, async f => {
        const p = pathOf(f); if (!p) return;
        const cur = this.docs.get(p);
        if (f.trashed) { if (cur && cur.fileId === f.id) { this.docs.delete(p); changed[p] = null; } return; }
        if (cur && cur.fileId === f.id && cur.mt === f.modifiedTime) return;
        const data = await this._readJson(f.id);
        this.docs.set(p, { fileId: f.id, mt: f.modifiedTime, data }); changed[p] = data;
      });
      this.lastPoll = now;
      if (Object.keys(changed).length) this.emit(changed);
    } finally { this.polling = false; }
  }
  // ---------- tulis (berurutan per dokumen) ----------
  _lock(p, fn) { const prev = this.locks.get(p) || Promise.resolve(); const next = prev.catch(() => {}).then(fn); this.locks.set(p, next); return next; }
  set(p, data) { return this._lock(p, () => this._write(p, data)); }
  update(p, patch) {
    return this._lock(p, async () => {
      const cur = this.docs.get(p);
      let base = cur?.data || {};
      if (cur) { try { base = await this._readJson(cur.fileId); } catch {} }
      const merged = { ...base };
      for (const [k, v] of Object.entries(patch)) { if (v && typeof v === 'object' && v.__delete__ === true) delete merged[k]; else merged[k] = v; }
      return this._write(p, merged);
    });
  }
  async _write(p, data) {
    const json = JSON.stringify(data), cur = this.docs.get(p);
    let r;
    if (cur) r = await this.g.driveUpdateMedia(cur.fileId, json, 'application/json');
    else {
      const [col, id] = splitPath(p);
      r = await this.g.driveCreate({ name: `${col.replace(/\//g, '~')}__${id}.json`, parents: [this.dataF.id], mimeType: 'application/json', appProperties: { dkc: col, dkd: id } }, json, 'application/json');
    }
    this.docs.set(p, { fileId: r.id || cur.fileId, mt: r.modifiedTime || new Date().toISOString(), data });
    this.emit({ [p]: data });
  }
  remove(p) {
    return this._lock(p, async () => {
      const cur = this.docs.get(p); if (!cur) return;
      await this.g.drivePatch(cur.fileId, { trashed: true });
      this.docs.delete(p); this.emit({ [p]: null });
    });
  }
  async add(col, data) { const id = crypto.randomBytes(15).toString('base64url').replace(/[-_]/g, '').slice(0, 20).toLowerCase(); await this.set(`${col}/${id}`, data); return id; }
  // ---------- aset ----------
  async upload(buf, type, name) {
    const r = await this.g.driveCreate({ name: name || `aset-${Date.now()}`, parents: [this.asetF.id], appProperties: { dk: 'aset' } }, buf, type);
    fs.writeFileSync(path.join(this.cacheDir, r.id), buf); fs.writeFileSync(path.join(this.cacheDir, r.id + '.type'), type || 'application/octet-stream');
    return { id: r.id, url: '/_blob/' + r.id, sizeBytes: buf.length, contentType: type };
  }
  async blob(id) {
    if (!/^[\w-]{10,}$/.test(id)) return null;
    const f = path.join(this.cacheDir, id);
    if (fs.existsSync(f)) return { buf: fs.readFileSync(f), type: (() => { try { return fs.readFileSync(f + '.type', 'utf8'); } catch { return 'application/octet-stream'; } })() };
    const r = await this.g.driveMedia(id);
    const buf = Buffer.from(await r.arrayBuffer()), type = r.headers.get('content-type') || 'application/octet-stream';
    fs.writeFileSync(f, buf); fs.writeFileSync(f + '.type', type);
    return { buf, type };
  }
  async deleteAsset(id) { try { await this.g.drivePatch(id, { trashed: true }); } catch {} try { fs.unlinkSync(path.join(this.cacheDir, id)); fs.unlinkSync(path.join(this.cacheDir, id + '.type')); } catch {} }
}
const pathOf = f => { const a = f.appProperties || {}; if (a.dkc && a.dkd) return `${a.dkc}/${a.dkd}`; const m = /^(.+)__(.+)\.json$/.exec(f.name || ''); return m ? `${m[1].replace(/~/g, '/')}/${m[2]}` : null; };
const splitPath = p => { const i = p.lastIndexOf('/'); return [p.slice(0, i), p.slice(i + 1)]; };
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } })); }
module.exports = { Store };
