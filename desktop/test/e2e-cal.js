const { _electron: electron } = require('playwright-core');
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..'), MOCK = 'http://127.0.0.1:47123', OUT = path.join(__dirname, 'out-cal');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const CRED = JSON.stringify({ installed: { client_id: '123-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-uji' } });
const state = () => fetch(MOCK + '/__state').then(r => r.json()), wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const app = await electron.launch({ args: [ROOT, '--no-sandbox'], env: { ...process.env, DK_USER_DATA: path.join(OUT, 'ud'), DK_GOOGLE_BASE: MOCK, DK_TEST_OPEN: '1', DK_TEST_SAVE_DIR: OUT, DK_POLL_MS: '1500' } });
  const pg = await app.firstWindow(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  try {
    await pg.waitForSelector('#pick'); await pg.evaluate(c => window.desktop.call('g:setCredText', c), CRED); await pg.reload();
    await pg.waitForSelector('#signin:not([disabled])'); await pg.click('#signin'); await pg.waitForSelector('#go:not([hidden])'); await pg.click('#go');
    await pg.waitForSelector('#setupForm'); await pg.fill('#suUser', 'koorprodi'); await pg.fill('#suPw', 'rahasia123'); await pg.fill('#suPw2', 'rahasia123'); await pg.click('#setupForm button[type=submit]');
    await pg.waitForSelector('#loginScr', { state: 'hidden' });
    await pg.click('#btnNew'); await pg.waitForSelector('[data-path="judul"]');
    await pg.fill('[data-path="judul"]', 'Sidang Seminar Proposal Tesis'); await pg.fill('[data-path="tempat"]', 'Gd. SFD Tower B Lt. 9');
    await pg.fill('[data-path="zoomLink"]', 'https://us06web.zoom.us/j/81234567890'); await wait(1200);
    await pg.click('[data-act="cal-simpan"]');
    await pg.waitForFunction(() => /Tercatat di Google Calendar/.test(document.querySelector('#calBox')?.innerText || ''), null, { timeout: 15000 });
    let ev = (await state()).events[0];
    console.log('• acara dibuat:', ev.summary, '|', ev.start.dateTime, ev.start.timeZone, '→', ev.end.dateTime, '| lokasi:', ev.location, '| pengingat:', JSON.stringify(ev.reminders), '| kirim:', ev.sendUpdates);
    console.log('• tombol Buka di Calendar:', await pg.getAttribute('#calBox a', 'href'));
    await pg.fill('[data-path="tempat"]', 'Ruang Sidang Pascasarjana'); await wait(7500);
    ev = (await state()).events[0]; console.log('• otomatis diperbarui, lokasi:', ev.location);
    // undang peserta
    await pg.click('.tab:has-text("Daftar hadir")'); const add = await pg.$('[data-act="add-peserta"]'); if (add) await add.click();
    await pg.fill('.prow .c-nama', 'Prof. Contoh'); await pg.fill('.prow .c-mail', 'prof@unj.ac.id'); await wait(1200);
    await pg.click('.tab:has-text("Detail")'); await pg.check('#calUndang'); await wait(2500);
    ev = (await state()).events[0]; console.log('• undang peserta:', JSON.stringify(ev.attendees), '| kirim:', ev.sendUpdates);
    await pg.screenshot({ path: path.join(OUT, 'cal.png'), fullPage: false });
    await pg.locator('#calBox').screenshot({ path: path.join(OUT, 'calbox.png') });
    // hapus kegiatan
    await pg.click('[data-act="del-kegiatan"]'); await pg.click('[data-act="del-kegiatan"]'); await wait(2500);
    console.log('• setelah kegiatan dihapus, jumlah acara:', (await state()).events.length);
    console.log('errs', errs); console.log('SELESAI');
  } catch (e) { console.error('GAGAL', e); await pg.screenshot({ path: path.join(OUT, 'gagal.png') }); console.error(errs); process.exitCode = 1; }
  finally { await app.close(); }
})();
