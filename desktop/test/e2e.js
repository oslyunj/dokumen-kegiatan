// Uji ujung-ke-ujung: dua "komputer" (dua folder data) memakai satu server Google tiruan.
const { _electron: electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const MOCK = 'http://127.0.0.1:' + (process.env.MOCK_PORT || 47123);
const OUT = path.join(__dirname, 'out'); fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const CRED = JSON.stringify({ installed: { client_id: '123-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-uji', redirect_uris: ['http://localhost'] } });
const log = (...a) => console.log('•', ...a);
const state = () => fetch(MOCK + '/__state').then(r => r.json());
const wait = ms => new Promise(r => setTimeout(r, ms));

async function launch(name) {
  const ud = path.join(OUT, 'ud-' + name), saves = path.join(OUT, 'unduhan-' + name);
  fs.mkdirSync(saves, { recursive: true });
  const app = await electron.launch({ args: [ROOT, '--no-sandbox'], env: { ...process.env, DK_USER_DATA: ud, DK_GOOGLE_BASE: MOCK, DK_TEST_OPEN: '1', DK_TEST_SAVE_DIR: saves, DK_POLL_MS: '1500' } });
  const page = await app.firstWindow(); const errs = [];
  page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.waitForLoadState('domcontentloaded');
  return { app, page, errs, saves };
}
async function connect(page) {
  await page.waitForSelector('#pick');
  await page.evaluate(c => window.desktop.call('g:setCredText', c), CRED);
  await page.reload(); await page.waitForSelector('#signin:not([disabled])');
  await page.click('#signin');
  await page.waitForSelector('#go:not([hidden])', { timeout: 20000 });
  log('tersambung sebagai', await page.textContent('#email'));
  await page.click('#go'); await page.waitForURL(/index\.html/);
}
(async () => {
  let A, B;
  try {
    // ===== Komputer A =====
    A = await launch('A'); await connect(A.page);
    const pa = A.page;
    await pa.waitForSelector('#setupForm', { timeout: 20000 });
    log('A: layar buat Admin pertama muncul');
    await pa.fill('#suUser', 'koorprodi'); await pa.fill('#suPw', 'rahasia123'); await pa.fill('#suPw2', 'rahasia123');
    await pa.click('#setupForm button[type=submit]');
    await pa.waitForSelector('#loginScr', { state: 'hidden', timeout: 20000 });
    log('A: masuk sebagai', (await pa.textContent('#btnAkun')).replace(/\s+/g, ' '));
    // tambah Operator
    await pa.click('#btnAkun'); await pa.click('[data-act="pengguna"]');
    await pa.fill('#paNama', 'Staf Prodi'); await pa.fill('#paUser', 'staf.mm'); await pa.selectOption('#paLevel', 'operator'); await pa.fill('#paPw', 'sandiawal1');
    await pa.click('#pgAdd button[type=submit]'); await pa.waitForSelector('text=Akun staf.mm dibuat', { timeout: 15000 });
    await pa.click('#penggunaDlg [data-act="dlg-tutup"]');
    // kegiatan baru
    await pa.click('#btnNew'); await pa.waitForSelector('[data-path="judul"]', { timeout: 15000 });
    await pa.fill('[data-path="judul"]', 'Rapat Kurikulum S2'); await pa.fill('[data-path="tempat"]', 'Ruang Sidang FEB');
    await wait(2500);
    // foto
    await pa.click('.tab:has-text("Foto")');
    const foto = path.join(OUT, 'foto.png');
    require('child_process').execSync(`python3 -c "from PIL import Image; Image.new('RGB',(1600,1200),(30,111,175)).save('${foto}')"`);
    await pa.setInputFiles('#fotoInput', foto);
    await pa.waitForSelector('.gallery img', { timeout: 20000 });
    await wait(1500);
    const imgOk = await pa.evaluate(() => { const i = document.querySelector('.gallery img'); return i.complete && i.naturalWidth > 0; });
    log('A: foto terunggah dan tampil dari Drive:', imgOk);
    // peserta (untuk email)
    await pa.click('.tab:has-text("Daftar hadir")');
    const addBtn = await pa.$('[data-act="add-peserta"]'); if (addBtn) await addBtn.click();
    await pa.fill('.prow .c-nama', 'Dr. Contoh Peserta'); await pa.fill('.prow .c-mail', 'peserta@contoh.ac.id');
    await wait(1500);
    // email draf
    await pa.click('.tab:has-text("Kirim email")');
    await pa.click('[data-act="kirim-draf"]');
    await pa.waitForFunction(() => /draf|Draf|dibuat/.test(document.querySelector('#editor')?.innerText || ''), null, { timeout: 20000 });
    await wait(1500);
    // unduh PDF paket
    await pa.click('.tab:has-text("Unduh")');
    await pa.click('button[data-kind="all"]');
    await pa.waitForFunction(() => /disimpan/.test(document.querySelector('#dlState')?.innerText || ''), null, { timeout: 60000 });
    log('A: unduhan:', fs.readdirSync(A.saves));
    // simpan ke Drive
    await pa.click('[data-act="drive"]');
    await pa.waitForFunction(() => /tersimpan|Terakhir disimpan|Buka folder/.test(document.querySelector('#editor')?.innerText || ''), null, { timeout: 60000 });
    await wait(3000);
    await pa.screenshot({ path: path.join(OUT, 'A-unduh.png') });
    let st = await state();
    log('Drive: berkas =', st.files.length, '| folder:', st.files.filter(f => f.mimeType.endsWith('folder')).map(f => f.name).join(' / '));
    log('Drive: docs =', st.files.filter(f => f.mimeType === 'application/vnd.google-apps.document').map(f => f.name).join(' | '));
    log('Gmail: draf =', st.drafts.length, '| To:', (/^To: (.+)$/m.exec(st.drafts[0]?.raw || '') || [])[1], '| Subject:', (/^Subject: (.+)$/m.exec(st.drafts[0]?.raw || '') || [])[1]);
    log('A errors:', A.errs);

    // ===== Komputer B =====
    B = await launch('B'); await connect(B.page);
    const pb = B.page;
    await pb.waitForSelector('#loginForm', { timeout: 20000 });
    log('B: layar login muncul (tanpa setup, tanpa tombol pemilik):', !(await pb.$('[data-act="login-owner"]')));
    await pb.fill('#lgUser', 'staf.mm'); await pb.fill('#lgPw', 'salah'); await pb.click('#lgBtn');
    await pb.waitForSelector('text=Username atau kata sandi salah');
    await pb.fill('#lgUser', 'staf.mm'); await pb.fill('#lgPw', 'sandiawal1'); await pb.click('#lgBtn');
    await pb.waitForSelector('#loginScr', { state: 'hidden' });
    log('B: masuk sebagai', (await pb.textContent('#btnAkun')).replace(/\s+/g, ' '));
    log('B: daftar kegiatan:', (await pb.textContent('#list, .list')).replace(/\s+/g, ' ').slice(0, 120));
    const bImg = await pb.evaluate(async () => { document.querySelector('.tab:nth-child(1)'); return true; });
    await pb.click('.tab:has-text("Foto")'); await pb.waitForSelector('.gallery img');
    await wait(1500);
    log('B: foto dari komputer A tampil:', await pb.evaluate(() => { const i = document.querySelector('.gallery img'); return i.complete && i.naturalWidth > 0; }));
    log('B: tombol hapus kegiatan (Operator) ada:', !!(await pb.$('[data-act="del-kegiatan"]')));
    await pb.click('.tab:has-text("Detail")');
    await pb.fill('[data-path="judul"]', 'Rapat Kurikulum S2 (diubah di B)');
    await pb.click('.tab:has-text("Undangan")'); await wait(2500);
    // A menerima perubahan dari B
    await pa.click('.tab:has-text("Undangan")');
    await pa.waitForFunction(() => /diubah di B/.test(document.querySelector('#hJudul')?.textContent || ''), null, { timeout: 30000 });
    log('A: menerima judul dari B:', await pa.textContent('#hJudul'), '|', (await pa.textContent('#hMeta')).replace(/\s+/g, ' '));
    await pb.screenshot({ path: path.join(OUT, 'B.png') });
    log('B errors:', B.errs);
    // restart A: sesi Google & login aplikasi tetap
    await A.app.close(); A = await launch('A');
    await A.page.waitForURL(/index\.html/, { timeout: 20000 });
    await A.page.waitForSelector('#loginScr', { state: 'hidden', timeout: 20000 });
    log('A dibuka ulang: langsung masuk tanpa login ulang:', (await A.page.textContent('#btnAkun')).replace(/\s+/g, ' '));
    await A.page.screenshot({ path: path.join(OUT, 'A-ulang.png') });
    console.log('SELESAI');
  } catch (e) {
    console.error('GAGAL', e);
    for (const X of [A, B]) if (X) { try { await X.page.screenshot({ path: path.join(OUT, 'gagal-' + (X === A ? 'A' : 'B') + '.png') }); console.error('errs', X.errs); } catch {} }
    process.exitCode = 1;
  } finally { for (const X of [A, B]) if (X) await X.app.close().catch(() => {}); }
})();
