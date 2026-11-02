const { _electron: electron } = require('playwright-core');
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..'), MOCK = 'http://127.0.0.1:47123', OUT = path.join(__dirname, 'out-berita');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const CRED = JSON.stringify({ installed: { client_id: '123-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-uji' } });
const state = () => fetch(MOCK + '/__state').then(r => r.json()), wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const app = await electron.launch({ args: [ROOT, '--no-sandbox'], env: { ...process.env, DK_USER_DATA: path.join(OUT, 'ud'), DK_GOOGLE_BASE: MOCK, DK_GEMINI_BASE: MOCK + '/gemini', DK_TEST_OPEN: '1', DK_TEST_SAVE_DIR: OUT, DK_POLL_MS: '1500' } });
  const pg = await app.firstWindow(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  try {
    await pg.waitForSelector('#pick'); await pg.evaluate(c => window.desktop.call('g:setCredText', c), CRED); await pg.reload();
    await pg.waitForSelector('#signin:not([disabled])'); await pg.click('#signin'); await pg.waitForSelector('#go:not([hidden])'); await pg.click('#go');
    await pg.waitForSelector('#setupForm'); await pg.fill('#suUser', 'koorprodi'); await pg.fill('#suPw', 'rahasia123'); await pg.fill('#suPw2', 'rahasia123'); await pg.click('#setupForm button[type=submit]');
    await pg.waitForSelector('#loginScr', { state: 'hidden' });
    await pg.click('#btnNew'); await pg.waitForSelector('[data-path="judul"]');
    await pg.fill('[data-path="judul"]', 'Sidang Seminar Proposal Tesis'); await pg.fill('[data-path="tempat"]', 'Gd. SFD Tower B Lt. 9');
    await pg.fill('[data-path="agenda"]', 'Pembukaan\nPaparan proposal 11 mahasiswa\nTanya jawab'); await wait(1000);
    await pg.click('.tab:has-text("Notulensi")'); await pg.fill('[data-path="notulen.pimpinan"]', 'Prof. Dr. Mohamad Rizan, S.E., M.M.'); await pg.fill('[data-path="notulen.pembahasan"]', 'Sebanyak 11 mahasiswa memaparkan proposal tesis.'); await wait(1200);
    await pg.click('.tab:has-text("Foto")'); const foto = path.join(OUT, 'f.jpg');
    require('child_process').execSync(`python3 -c "from PIL import Image; Image.new('RGB',(3000,2000),(30,111,175)).save('${foto}', quality=92)"`);
    await pg.setInputFiles('#fotoInput', [foto, foto]); await pg.waitForSelector('.gallery .ph:nth-child(2) img', { timeout: 30000 }); await pg.fill('.ph:nth-child(1) .cell', 'Prof. Rizan membuka sidang'); await wait(2000);
    await pg.click('.tab:has-text("Berita")'); await pg.waitForSelector('#aiKey');
    console.log('• kotak kunci Gemini muncul; tombol buat nonaktif:', await pg.isDisabled('[data-act="ai-buat"]'));
    await pg.fill('#aiKey', 'AIzaSALAH-kunci-salah-0000000000'); await pg.click('[data-act="ai-key"]'); await wait(800);
    console.log('• kunci salah:', (await pg.textContent('.note:has(#aiKey)')).split('tempel di sini.').pop().trim());
    await pg.fill('#aiKey', ' AQ.Ab8uji-KunciFormatBaru_12345678901234567890 '); await pg.click('[data-act="ai-key"]'); await wait(800);
    console.log('• kunci benar: kotak hilang:', !(await pg.$('#aiKey')), '| model:', (await pg.evaluate(() => window.__dkAI.status())).model);
    await pg.selectOption('[data-path="berita.gaya"]', 'rilis'); await pg.fill('[data-path="berita.narasumber"]', 'Dr. Osly Usman, Koorprodi'); await pg.fill('[data-path="berita.kutipan"]', 'Kami ingin mahasiswa lulus tepat waktu.'); await wait(900);
    await pg.click('[data-act="ai-buat"]'); await pg.waitForSelector('.bjudul', { timeout: 20000 });
    console.log('• judul:', await pg.inputValue('.bjudul'), '| isi:', (await pg.inputValue('.bout')).slice(0, 80).replace(/\n/g, ' / '));
    const st = await state(); const pr = st.gemini.at(-1).prompt;
    console.log('• foto terkirim ke Gemini:', JSON.stringify(st.gemini.at(-1).foto), '| aturan foto ada:', pr.includes('Jangan menebak nama'), '| keterangan foto:', pr.includes('Prof. Rizan membuka sidang'));
    console.log('• prompt memuat fakta:', ['Sidang Seminar Proposal Tesis', 'Gd. SFD Tower B', 'Prof. Dr. Mohamad Rizan', '11 mahasiswa', 'Kami ingin mahasiswa lulus tepat waktu', 'Siaran pers'].map(x => x + '=' + pr.includes(x)).join(' '));
    await pg.click('[data-act="ai-pdf"]'); await wait(4000);
    await pg.click('.tab:has-text("Berita")'); await pg.click('[data-act="ai-drive"]'); await pg.waitForSelector('text=Buka Google Docs berita', { timeout: 15000 });
    await pg.fill('#bRedaksi', 'redaksi@media.co.id, berita@koran.id'); await wait(900); await pg.click('[data-act="ai-draf"]'); await pg.waitForSelector('text=Draf dibuat', { timeout: 15000 });
    const s2 = await state(); const d = s2.drafts.at(-1).raw;
    console.log('• Google Docs:', s2.files.filter(f => f.name.startsWith('Berita - ')).map(f => f.name + ' (' + f.mimeType.split('.').pop() + ')'));
    console.log('• draf redaksi To:', (/^To: (.+)$/m.exec(d) || [])[1], '| Subject:', (/^Subject: (.+)$/m.exec(d) || [])[1]);
    console.log('• PDF:', fs.readdirSync(OUT).filter(f => f.endsWith('.pdf')));
    await pg.screenshot({ path: path.join(OUT, 'berita.png') });
    console.log('errs', errs); console.log('SELESAI');
  } catch (e) { console.error('GAGAL', e); await pg.screenshot({ path: path.join(OUT, 'gagal.png') }); console.error(errs); process.exitCode = 1; }
  finally { await app.close(); }
})();
