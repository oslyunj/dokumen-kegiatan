// Akses Google (OAuth 2.0 untuk aplikasi desktop + REST API Drive/Gmail).
// Semua alamat bisa diarahkan ke server tiruan lewat DK_GOOGLE_BASE untuk pengujian.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MOCK = process.env.DK_GOOGLE_BASE || '';
const U = {
  auth: MOCK ? MOCK + '/o/oauth2/v2/auth' : 'https://accounts.google.com/o/oauth2/v2/auth',
  token: MOCK ? MOCK + '/token' : 'https://oauth2.googleapis.com/token',
  revoke: MOCK ? MOCK + '/revoke' : 'https://oauth2.googleapis.com/revoke',
  userinfo: MOCK ? MOCK + '/userinfo' : 'https://openidconnect.googleapis.com/v1/userinfo',
  drive: MOCK ? MOCK + '/drive/v3' : 'https://www.googleapis.com/drive/v3',
  driveUp: MOCK ? MOCK + '/upload/drive/v3' : 'https://www.googleapis.com/upload/drive/v3',
  gmail: MOCK ? MOCK + '/gmail/v1' : 'https://gmail.googleapis.com/gmail/v1',
  gmailUp: MOCK ? MOCK + '/upload/gmail/v1' : 'https://gmail.googleapis.com/upload/gmail/v1',
  cal: MOCK ? MOCK + '/calendar/v3' : 'https://www.googleapis.com/calendar/v3',
};
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/calendar.events'];

class GError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

class Google {
  constructor({ dir, safeStorage, openExternal }) {
    this.dir = dir; this.safe = safeStorage; this.openExternal = openExternal;
    this.credFile = path.join(dir, 'kredensial-google.json');
    this.tokFile = path.join(dir, 'token-google.bin');
    this.cred = this._readCred(); this.tok = this._readTok(); this.access = null; this.accessExp = 0; this.email = this.tok?.email || '';
  }
  // ---------- kredensial (berkas JSON dari Google Cloud) ----------
  _readCred() { try { return JSON.parse(fs.readFileSync(this.credFile, 'utf8')); } catch { return null; } }
  setCredentials(json) {
    let o; try { o = typeof json === 'string' ? JSON.parse(json) : json; } catch { throw new GError('bad_credentials', 'Berkas bukan JSON yang valid.'); }
    const c = o.installed || o.web || o;
    if (!c.client_id || !c.client_secret) throw new GError('bad_credentials', 'Berkas tidak berisi client_id dan client_secret. Unduh JSON dari OAuth Client bertipe "Desktop app".');
    if (o.web) throw new GError('bad_credentials', 'Ini kredensial tipe "Web application". Buat OAuth Client bertipe "Desktop app", lalu unduh JSON-nya.');
    this.cred = { client_id: c.client_id, client_secret: c.client_secret };
    fs.writeFileSync(this.credFile, JSON.stringify(this.cred));
    return true;
  }
  // ---------- token ----------
  _readTok() {
    try {
      const b = fs.readFileSync(this.tokFile);
      const s = this.safe?.isEncryptionAvailable() ? this.safe.decryptString(b) : b.toString('utf8');
      return JSON.parse(s);
    } catch { return null; }
  }
  _saveTok() {
    const s = JSON.stringify(this.tok);
    fs.writeFileSync(this.tokFile, this.safe?.isEncryptionAvailable() ? this.safe.encryptString(s) : Buffer.from(s, 'utf8'));
  }
  status() { return { hasCred: !!this.cred, signedIn: !!this.tok?.refresh_token, email: this.email, clientId: this.cred?.client_id || '' }; }
  async signOut() {
    const rt = this.tok?.refresh_token;
    this.tok = null; this.access = null; this.email = '';
    try { fs.unlinkSync(this.tokFile); } catch {}
    if (rt) { try { await fetch(U.revoke + '?token=' + encodeURIComponent(rt), { method: 'POST' }); } catch {} }
  }
  // ---------- login dengan browser (loopback + PKCE) ----------
  signIn(loginHint) {
    if (!this.cred) return Promise.reject(new GError('no_credentials', 'Kredensial Google belum dipasang.'));
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');
    return new Promise((resolve, reject) => {
      let done = false;
      const srv = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/') { res.writeHead(404); res.end(); return; }
        const code = url.searchParams.get('code'), err = url.searchParams.get('error');
        const page = (t, m) => `<!doctype html><meta charset="utf-8"><title>${t}</title><body style="font:16px system-ui;background:#EAF5FD;color:#12263A;display:grid;place-items:center;height:100vh;margin:0"><div style="background:#fff;padding:28px 32px;border-radius:14px;border:1px solid #C9E1F3;max-width:440px"><h2 style="margin:0 0 8px">${t}</h2><p style="margin:0">${m}</p></div>`;
        if (url.searchParams.get('state') !== state) { res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page('Gagal', 'Permintaan tidak dikenali. Ulangi dari aplikasi.')); return; }
        if (err || !code) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page('Masuk dibatalkan', 'Anda bisa menutup tab ini dan mencoba lagi dari aplikasi.')); finish(new GError('declined', 'Masuk ke Google dibatalkan.')); return; }
        try {
          const port = srv.address().port;
          const r = await fetch(U.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: this.cred.client_id, client_secret: this.cred.client_secret, redirect_uri: `http://127.0.0.1:${port}`, grant_type: 'authorization_code', code_verifier: verifier }) });
          const j = await r.json();
          if (!r.ok || !j.refresh_token) throw new GError('auth_failed', j.error_description || j.error || 'Google tidak memberikan token.');
          this.tok = { refresh_token: j.refresh_token };
          this.access = j.access_token; this.accessExp = Date.now() + (j.expires_in - 60) * 1000;
          this.email = await this._fetchEmail().catch(() => '');
          this.tok.email = this.email; this._saveTok();
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page('Berhasil masuk', `Akun <b>${this.email}</b> tersambung. Tutup tab ini dan kembali ke aplikasi Dokumen Kegiatan.`));
          finish(null, this.status());
        } catch (e) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page('Gagal masuk', String(e.message || e))); finish(e); }
      });
      const timer = setTimeout(() => finish(new GError('timeout', 'Waktu masuk habis (5 menit). Coba lagi.')), 300000);
      const finish = (e, v) => { if (done) return; done = true; clearTimeout(timer); setTimeout(() => srv.close(), 500); e ? reject(e) : resolve(v); };
      srv.listen(0, '127.0.0.1', () => {
        const port = srv.address().port;
        const q = new URLSearchParams({ client_id: this.cred.client_id, redirect_uri: `http://127.0.0.1:${port}`, response_type: 'code', scope: SCOPES.join(' '), code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', state, ...(loginHint ? { login_hint: loginHint } : {}) });
        this.openExternal(U.auth + '?' + q.toString());
      });
    });
  }
  async _fetchEmail() { const r = await this.req(U.userinfo); return r.email || ''; }
  async token() {
    if (this.access && Date.now() < this.accessExp) return this.access;
    if (!this.tok?.refresh_token || !this.cred) throw new GError('needs_reauth', 'Belum masuk ke Google.');
    const r = await fetch(U.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.cred.client_id, client_secret: this.cred.client_secret, refresh_token: this.tok.refresh_token, grant_type: 'refresh_token' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { if (j.error === 'invalid_grant') throw new GError('needs_reauth', 'Sambungan Google kedaluwarsa atau dicabut. Masuk ulang ke Google dari menu Akun Google.'); throw new GError('network', j.error_description || 'Gagal memperbarui token Google.'); }
    this.access = j.access_token; this.accessExp = Date.now() + (j.expires_in - 60) * 1000;
    return this.access;
  }
  // permintaan REST umum dengan coba ulang untuk 429/5xx
  async req(url, { method = 'GET', headers = {}, body, raw = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      let r;
      try { r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + await this.token(), ...headers }, body }); }
      catch (e) { if (e instanceof GError) throw e; if (attempt < 3) { await sleep(800 * (attempt + 1)); continue; } throw new GError('network', 'Tidak bisa terhubung ke Google. Periksa koneksi internet.'); }
      if (r.status === 401 && attempt === 0) { this.access = null; continue; }
      if ((r.status === 429 || r.status >= 500) && attempt < 4) { await sleep(1000 * 2 ** attempt); continue; }
      if (!r.ok) {
        let m = r.statusText; try { const j = await r.json(); m = j.error?.message || j.error_description || m; } catch {}
        if (r.status === 403 && /insufficient|scope/i.test(m) && url.startsWith(U.cal)) throw new GError('tool_error', 'Izin Google Calendar belum diberikan. Buka menu Aplikasi → Akun Google…, klik Masuk ulang, lalu centang izin Calendar', 403);
        if (r.status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(m)) throw new GError('tool_error', 'API Google ini belum diaktifkan di proyek Google Cloud (lihat panduan: aktifkan Google Calendar API)', 403);
        throw new GError(r.status === 401 ? 'needs_reauth' : r.status === 404 || r.status === 410 ? 'tool_error' : r.status === 403 ? 'forbidden' : 'tool_error', (r.status === 404 || r.status === 410 ? 'not found: ' : '') + m, r.status);
      }
      if (raw) return r;
      const t = await r.text(); return t ? JSON.parse(t) : {};
    }
  }
  // ---------- Drive ----------
  driveFiles(q, fields = 'id,name,mimeType,modifiedTime,trashed,appProperties,webViewLink', extra = {}) {
    const all = [];
    const page = async tok => {
      const p = new URLSearchParams({ q, fields: `nextPageToken,files(${fields})`, pageSize: '1000', spaces: 'drive', ...extra, ...(tok ? { pageToken: tok } : {}) });
      const r = await this.req(`${U.drive}/files?${p}`); all.push(...(r.files || [])); return r.nextPageToken;
    };
    return (async () => { let t = await page(); while (t) t = await page(t); return all; })();
  }
  driveGet(id, fields = 'id,name,mimeType,webViewLink,parents,owners(emailAddress),capabilities(canAddChildren),trashed') { return this.req(`${U.drive}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`); }
  driveMedia(id) { return this.req(`${U.drive}/files/${encodeURIComponent(id)}?alt=media`, { raw: true }); }
  driveExport(id, mime) { return this.req(`${U.drive}/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(mime)}`, { raw: true }); }
  drivePatch(id, meta, qs = '') { return this.req(`${U.drive}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,webViewLink,parents,modifiedTime${qs}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) }); }
  // buat berkas: metadata saja (folder) atau metadata + isi (multipart; berkas besar pakai resumable)
  async driveCreate(meta, data, mime) {
    const fields = 'id,name,mimeType,webViewLink,modifiedTime,parents';
    if (data == null) return this.req(`${U.drive}/files?fields=${fields}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) });
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buf.length > 4.5 * 1024 * 1024) {
      const init = await this.req(`${U.driveUp}/files?uploadType=resumable&fields=${fields}`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime || 'application/octet-stream', 'X-Upload-Content-Length': String(buf.length) }, body: JSON.stringify(meta), raw: true });
      const loc = init.headers.get('location');
      const r = await this.req(loc, { method: 'PUT', headers: { 'Content-Type': mime || 'application/octet-stream' }, body: buf });
      return r;
    }
    const b = 'dk' + crypto.randomBytes(12).toString('hex');
    const body = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mime || 'application/octet-stream'}\r\n\r\n`),
      buf, Buffer.from(`\r\n--${b}--`)]);
    return this.req(`${U.driveUp}/files?uploadType=multipart&fields=${fields}`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
  }
  driveUpdateMedia(id, data, mime) {
    return this.req(`${U.driveUp}/files/${encodeURIComponent(id)}?uploadType=media&fields=id,modifiedTime`, { method: 'PATCH', headers: { 'Content-Type': mime || 'application/octet-stream' }, body: Buffer.isBuffer(data) ? data : Buffer.from(data) });
  }
  // ---------- Calendar ----------
  calInsert(ev, send) { return this.req(`${U.cal}/calendars/primary/events?sendUpdates=${send}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev) }); }
  calGet(id) { return this.req(`${U.cal}/calendars/primary/events/${encodeURIComponent(id)}`); }
  calPatch(id, ev, send) { return this.req(`${U.cal}/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=${send}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev) }); }
  calDelete(id, send) { return this.req(`${U.cal}/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=${send}`, { method: 'DELETE' }); }
  // ---------- Gmail ----------
  gmailSend(mime) { return this.req(`${U.gmailUp}/users/me/messages/send?uploadType=media`, { method: 'POST', headers: { 'Content-Type': 'message/rfc822' }, body: mime }); }
  gmailDraft(mime) { return this.req(`${U.gmailUp}/users/me/drafts?uploadType=media`, { method: 'POST', headers: { 'Content-Type': 'message/rfc822' }, body: mime }); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = { Google, GError };
