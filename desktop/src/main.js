// Dokumen Kegiatan - aplikasi desktop (Windows)
// S2 Magister Manajemen FEB UNJ - dibuat oleh Koorprodi Dr. Osly Usman, M.BusSyst
const { app, BrowserWindow, protocol, ipcMain, dialog, shell, Menu, safeStorage, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { Google } = require('./google');
const { Store } = require('./store');
const { makeTools } = require('./tools');
const { Gemini } = require('./gemini');

if (process.env.DK_USER_DATA) app.setPath('userData', process.env.DK_USER_DATA);
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const UI = path.join(__dirname, 'ui');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const EXPECTED = 'mm.febunj@gmail.com';
let win, google, store, callTool, pollTimer, gemini;

const ok = v => ({ ok: true, v });
const fail = e => ({ ok: false, error: { code: e?.code || 'error', message: String(e?.message || e) } });
const wrap = fn => async (_e, ...a) => { try { return ok(await fn(...a)); } catch (e) { console.error(e); return fail(e); } };
const emit = changed => { if (win && !win.isDestroyed()) win.webContents.send('db:changes', changed); };

function makeStore() { store = new Store(google, path.join(app.getPath('userData'), 'cache-aset'), emit); callTool = makeTools(google); }

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 960, minHeight: 640, show: false, backgroundColor: '#EAF5FD', title: 'Dokumen Kegiatan',
    icon: path.join(UI, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  const external = url => /^(https?|mailto):/i.test(url);
  win.webContents.setWindowOpenHandler(({ url }) => { if (external(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (external(url)) { e.preventDefault(); shell.openExternal(url); } });
  win.on('focus', () => store?.poll().catch(() => {}));
  win.loadURL('app://local/setup.html');
}

// Copot pemasangan: jalankan pencopot bawaan Windows (dibuat installer), opsional hapus data lokal
async function uninstall() {
  const dir = path.dirname(process.execPath);
  const exe = fs.existsSync(dir) ? fs.readdirSync(dir).find(f => /^Uninstall .*\.exe$/i.test(f)) : null;
  if (!app.isPackaged || process.platform !== 'win32' || !exe) {
    await dialog.showMessageBox(win, { type: 'info', title: 'Copot pemasangan', message: 'Pencopot pemasangan tidak ditemukan.', detail: 'Copot lewat Windows: Settings → Apps → Installed apps → Dokumen Kegiatan → Uninstall.' });
    return;
  }
  const r = await dialog.showMessageBox(win, {
    type: 'warning', title: 'Copot pemasangan Dokumen Kegiatan',
    message: 'Copot aplikasi Dokumen Kegiatan dari komputer ini?',
    detail: 'Data kegiatan, berkas, dan foto di Google Drive TIDAK ikut terhapus dan tetap bisa dibuka dari komputer lain.\n\nCentang pilihan di bawah untuk juga menghapus sambungan Google dan cache di komputer ini (disarankan bila komputer ini tidak dipakai lagi untuk Prodi).',
    checkboxLabel: 'Hapus juga sambungan Google dan data cache di komputer ini', checkboxChecked: true,
    buttons: ['Batal', 'Copot pemasangan'], defaultId: 0, cancelId: 0, noLink: true,
  });
  if (r.response !== 1) return;
  if (r.checkboxChecked) {
    try { await google.signOut(); } catch {}
    for (const f of ['kredensial-google.json', 'token-google.bin', 'kunci-gemini.bin']) { try { fs.unlinkSync(path.join(app.getPath('userData'), f)); } catch {} }
    try { fs.rmSync(path.join(app.getPath('userData'), 'cache-aset'), { recursive: true, force: true }); } catch {}
  }
  const { spawn } = require('child_process');
  spawn(path.join(dir, exe), [], { detached: true, stdio: 'ignore', cwd: require('os').tmpdir() }).unref();
  app.quit();
}
// buka folder arsip di browser dengan akun Google yang dipakai aplikasi (bukan akun lain yang kebetulan aktif di browser)
async function bukaArsip() {
  try { if (!store?.root && google?.status().signedIn) await store.init(); } catch {}
  const r = store?.root, em = google?.email || '';
  if (!r?.id) { await dialog.showMessageBox(win, { type: 'info', title: 'Folder arsip', message: 'Folder arsip belum bisa dibuka.', detail: 'Pastikan komputer terhubung ke internet dan sudah masuk ke Google (menu Aplikasi → Akun Google…), lalu coba lagi.' }); return; }
  const base = `https://drive.google.com/drive/folders/${r.id}`;
  const url = em ? `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(em)}&continue=${encodeURIComponent(base + '?authuser=' + encodeURIComponent(em))}` : base;
  shell.openExternal(url);
}
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Aplikasi', submenu: [
      { label: 'Muat ulang', accelerator: 'CmdOrCtrl+R', click: () => win?.webContents.reload() },
      { label: 'Ambil perubahan terbaru', accelerator: 'F5', click: () => store?.poll().catch(() => {}) },
      { type: 'separator' },
      { label: 'Akun Google…', click: () => win?.loadURL('app://local/setup.html?ubah=1') },
      { label: 'Hapus kunci Gemini di komputer ini', click: async () => { gemini?.clear(); await dialog.showMessageBox(win, { type: 'info', message: 'Kunci Gemini dihapus dari komputer ini.', detail: 'Pasang lagi lewat tab Berita bila diperlukan.' }); win?.webContents.reload(); } },
      { label: 'Buka folder arsip di Google Drive', click: () => bukaArsip() },
      { type: 'separator' },
      { label: 'Copot pemasangan (Uninstall)…', click: () => uninstall() },
      { type: 'separator' },
      { role: 'quit', label: 'Keluar' },
    ] },
    { label: 'Edit', submenu: [{ role: 'undo', label: 'Urungkan' }, { role: 'redo', label: 'Ulangi' }, { type: 'separator' }, { role: 'cut', label: 'Potong' }, { role: 'copy', label: 'Salin' }, { role: 'paste', label: 'Tempel' }, { role: 'selectAll', label: 'Pilih semua' }] },
    { label: 'Tampilan', submenu: [{ role: 'zoomIn', label: 'Perbesar' }, { role: 'zoomOut', label: 'Perkecil' }, { role: 'resetZoom', label: 'Ukuran normal' }, { type: 'separator' }, { role: 'togglefullscreen', label: 'Layar penuh' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] },
    { label: 'Bantuan', submenu: [{ label: 'Tentang Dokumen Kegiatan', click: () => dialog.showMessageBox(win, { type: 'info', title: 'Tentang', message: `Dokumen Kegiatan ${app.getVersion()}`, detail: 'S2 Magister Manajemen\nFakultas Ekonomi dan Bisnis\nUniversitas Negeri Jakarta\n\nDibuat oleh Koorprodi Dr. Osly Usman, M.BusSyst' }) }] },
  ]));
}

app.whenReady().then(() => {
  // DK_TEST_OPEN hanya untuk pengujian otomatis: halaman login Google dibuka tanpa browser
  const openAuth = process.env.DK_TEST_OPEN ? url => fetch(url).catch(() => {}) : url => shell.openExternal(url);
  google = new Google({ dir: app.getPath('userData'), safeStorage, openExternal: openAuth });
  gemini = new Gemini(app.getPath('userData'), safeStorage);
  makeStore();
  protocol.handle('app', async req => {
    const u = new URL(req.url);
    if (u.pathname.startsWith('/_blob/')) {
      try { const b = await store.blob(decodeURIComponent(u.pathname.slice(7))); if (!b) return new Response('not found', { status: 404 }); return new Response(b.buf, { headers: { 'Content-Type': b.type, 'Cache-Control': 'max-age=31536000' } }); }
      catch { return new Response('not found', { status: 404 }); }
    }
    const p = path.normalize(path.join(UI, decodeURIComponent(u.pathname)));
    if (!p.startsWith(UI) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return new Response('not found', { status: 404 });
    return new Response(fs.readFileSync(p), { headers: { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' } });
  });

  // ----- Google -----
  ipcMain.handle('g:status', wrap(async () => ({ ...google.status(), expected: EXPECTED, version: app.getVersion() })));
  ipcMain.handle('g:pickCred', wrap(async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Pilih berkas kredensial Google (JSON)', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return google.status();
    google.setCredentials(fs.readFileSync(r.filePaths[0], 'utf8')); return google.status();
  }));
  ipcMain.handle('g:setCredText', wrap(async t => { google.setCredentials(t); return google.status(); }));
  ipcMain.handle('g:signIn', wrap(async () => { const s = await google.signIn(EXPECTED); makeStore(); win?.focus(); return s; }));
  ipcMain.handle('g:signOut', wrap(async () => { await google.signOut(); makeStore(); return google.status(); }));
  // ----- database -----
  ipcMain.handle('db:init', wrap(() => store.init()));
  ipcMain.handle('db:set', wrap((p, d) => store.set(p, d)));
  ipcMain.handle('db:update', wrap((p, d) => store.update(p, d)));
  ipcMain.handle('db:delete', wrap(p => store.remove(p)));
  ipcMain.handle('db:add', wrap((c, d) => store.add(c, d)));
  ipcMain.handle('db:poll', wrap(() => store.poll()));
  // ----- aset -----
  ipcMain.handle('as:upload', wrap((buf, type, name) => store.upload(Buffer.from(buf), type, name)));
  ipcMain.handle('as:delete', wrap(id => store.deleteAsset(id)));
  // ----- unduhan -----
  ipcMain.handle('dl:save', wrap(async ({ filename, data }) => {
    const r = process.env.DK_TEST_SAVE_DIR ? { filePath: path.join(process.env.DK_TEST_SAVE_DIR, filename) }
      : await dialog.showSaveDialog(win, { title: 'Simpan berkas', defaultPath: path.join(app.getPath('downloads'), filename) });
    if (r.canceled || !r.filePath) { const e = new Error('Dibatalkan'); e.code = 'declined'; throw e; }
    fs.writeFileSync(r.filePath, typeof data === 'string' ? data : Buffer.from(data));
    if (!process.env.DK_TEST_SAVE_DIR) shell.showItemInFolder(r.filePath);
    return { status: 'saved', path: r.filePath };
  }));
  // ----- Gmail & Drive -----
  ipcMain.handle('mcp:call', wrap((server, tool, input) => callTool(server, tool, input)));
  // ----- Gemini -----
  ipcMain.handle('ai:status', wrap(async () => gemini.status()));
  ipcMain.handle('ai:setKey', wrap(k => gemini.setKey(k)));
  ipcMain.handle('ai:clear', wrap(async () => { gemini.clear(); return gemini.status(); }));
  ipcMain.handle('ai:generate', wrap((p, imgs) => gemini.generate(p, imgs)));
  ipcMain.handle('app:open', wrap(url => { if (/^https?:/i.test(url)) shell.openExternal(url); }));

  buildMenu(); createWindow();
  pollTimer = setInterval(() => { if (win && !win.isDestroyed() && store?.dataF) store.poll().catch(() => {}); }, Number(process.env.DK_POLL_MS || 15000));
});
app.on('window-all-closed', () => { clearInterval(pollTimer); app.quit(); });
