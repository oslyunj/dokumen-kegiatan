// Gemini (Google AI Studio) untuk menyusun berita. Kunci API disimpan terenkripsi di komputer ini saja.
const fs = require('fs');
const path = require('path');
const BASE = process.env.DK_GEMINI_BASE || 'https://generativelanguage.googleapis.com/v1beta';
const FALLBACK = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash'];

class Gemini {
  constructor(dir, safe) { this.file = path.join(dir, 'kunci-gemini.bin'); this.safe = safe; this.key = this._read(); this.model = null; }
  _read() { try { const b = fs.readFileSync(this.file); return this.safe?.isEncryptionAvailable() ? this.safe.decryptString(b) : b.toString('utf8'); } catch { return ''; } }
  status() { return { hasKey: !!this.key, model: this.model || '' }; }
  async setKey(k) {
    k = String(k || '').replace(/[\s"'`]/g, '');
    if (!/^[\w.\-]{20,}$/.test(k)) throw err('bad_key', 'Kunci tidak dikenali. Di aistudio.google.com/apikey, buka kuncinya lalu klik "Copy key", kemudian tempel di sini.');
    const prev = this.key; this.key = k; this.model = null;
    try { await this.pickModel(); }
    catch (e) {
      // hanya tolak bila Google jelas menolak kuncinya; gangguan lain (jaringan, daftar model) tidak menghalangi penyimpanan
      if (e.code === 'bad_key' || e.code === 'api_off') { this.key = prev; throw e; }
      this.model = FALLBACK[0];
    }
    fs.writeFileSync(this.file, this.safe?.isEncryptionAvailable() ? this.safe.encryptString(k) : Buffer.from(k, 'utf8'));
    return this.status();
  }
  clear() { this.key = ''; this.model = null; try { fs.unlinkSync(this.file); } catch {} }
  async call(url, body) {
    let r;
    try { r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'x-goog-api-key': this.key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(body ? 180000 : 20000) }); }
    catch (e) { throw err('network', e?.name === 'TimeoutError' ? 'Gemini tidak menjawab (waktu habis). Periksa koneksi internet lalu coba lagi.' : 'Tidak bisa terhubung ke Gemini. Periksa koneksi internet.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = j.error?.message || r.statusText, why = JSON.stringify(j.error?.details || []);
      if (/SERVICE_DISABLED|has not been used|is disabled/i.test(m + why)) throw err('api_off', 'Generative Language API belum aktif di proyek Google Cloud. Buka console.cloud.google.com/apis/library/generativelanguage.googleapis.com, klik Enable, tunggu 1–2 menit, lalu simpan kunci lagi.');
      if (/API_KEY_INVALID|API key not valid|API_KEY_SERVICE_BLOCKED|API key expired/i.test(m + why)) throw err('bad_key', 'Kunci API Gemini ditolak Google. Salin ulang atau buat kunci baru di aistudio.google.com/apikey.');
      if (r.status === 400 && /API key/i.test(m) || r.status === 401 || r.status === 403 && /key|permission/i.test(m)) throw err('bad_key', 'Kunci API Gemini ditolak. Periksa atau buat ulang kunci di aistudio.google.com/apikey.');
      if (r.status === 429) throw err('rate_limited', 'Kuota Gemini sedang habis. Tunggu satu menit lalu coba lagi.');
      if (r.status === 503 || r.status === 500 || r.status === 504 || /high demand|overloaded|UNAVAILABLE|try again later/i.test(m)) throw err('busy', 'Server Gemini sedang penuh. Coba lagi beberapa menit lagi.');
      throw err('tool_error', m);
    }
    return j;
  }
  // pilih model "flash" terbaru yang stabil dan bisa generateContent
  async pickModel() {
    if (this.model) return this.model;
    if (!this.key) throw err('no_key', 'Kunci API Gemini belum dipasang.');
    const j = await this.call(`${BASE}/models?pageSize=200`);
    const ok = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''));
    const flash = ok.filter(n => /flash/.test(n) && !/lite|image|tts|live|audio|thinking|exp|preview|embedding|8b/.test(n));
    const ver = n => { const m = /gemini-(\d+(?:\.\d+)?)/.exec(n); return m ? parseFloat(m[1]) : 0; };
    flash.sort((a, b) => ver(b) - ver(a) || a.length - b.length);
    this.model = flash[0] || FALLBACK.find(f => ok.includes(f)) || ok.find(n => /gemini/.test(n)) || FALLBACK[0];
    // cadangan bila model utama penuh: flash lain, lalu flash-lite, lalu versi "latest"
    const lite = ok.filter(n => /flash-lite/.test(n) && !/preview|exp|image|tts|live/.test(n)).sort((a, b) => ver(b) - ver(a));
    this.cadangan = [...new Set([...flash.slice(1), ...lite, ...FALLBACK.filter(f => ok.includes(f))])].filter(n => n !== this.model).slice(0, 4);
    return this.model;
  }
  async generate(prompt, images = []) {
    if (!this.key) throw err('no_key', 'Kunci API Gemini belum dipasang.');
    const utama = await this.pickModel(), daftar = [utama, ...(this.cadangan || FALLBACK.filter(f => f !== utama))];
    const parts = [{ text: String(prompt) }, ...(images || []).slice(0, 4).filter(i => i?.data).map(i => ({ inlineData: { mimeType: i.mimeType || 'image/jpeg', data: i.data } }))];
    const body = { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.6, maxOutputTokens: 8192 } };
    let j, model, last;
    // model utama dicoba 3x (jeda 2, 5 detik); bila tetap penuh/kuota habis, pindah ke model cadangan
    luar: for (const [i, m] of daftar.entries()) {
      for (let t = 0; t < (i === 0 ? 3 : 2); t++) {
        try { j = await this.call(`${BASE}/models/${encodeURIComponent(m)}:generateContent`, body); model = m; break luar; }
        catch (e) {
          last = e;
          if (e.code === 'busy' && t < (i === 0 ? 2 : 1)) { await new Promise(r => setTimeout(r, [2000, 5000][t])); continue; }
          if (e.code === 'busy' || e.code === 'rate_limited' || /not found|is not supported/i.test(e.message)) break;
          throw e;
        }
      }
    }
    if (!j) throw last?.code === 'rate_limited' ? last : err('busy', 'Semua model Gemini sedang penuh. Coba lagi 5–10 menit lagi; isian tidak hilang.');
    const c = j.candidates?.[0];
    const text = (c?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
    if (!text) throw err('tool_error', c?.finishReason === 'SAFETY' ? 'Gemini menolak menulis (filter keamanan). Ubah catatan tambahan lalu coba lagi.' : 'Gemini tidak mengembalikan teks.');
    return { text, truncated: c?.finishReason === 'MAX_TOKENS', model };
  }
}
const err = (code, message) => Object.assign(new Error(message), { code });
module.exports = { Gemini };
