"""Buat src/ui/index.html (versi desktop) dari halaman aplikasi claude.ai.
Pemakaian: python3 build-ui.py <index.html sumber>"""
import sys, re, pathlib
src = pathlib.Path(sys.argv[1]).read_text()
out = pathlib.Path(__file__).parent / 'src' / 'ui' / 'index.html'
s = src
def rep(a, b, n=1):
    global s
    c = s.count(a)
    assert c == n, f'{c}x: {a[:90]}'
    s = s.replace(a, b)

# 1. jembatan ke Google Drive/Gmail dimuat sebelum skrip aplikasi
rep('<body>\n<title>', '<body>\n<script src="adapter.js"></script>\n<title>')
# 2. batas ukuran lampiran: Gmail API menerima email hingga 25 MB
rep('const INLINE_MAX = 760000;', 'const INLINE_MAX = 17 * 1024 * 1024;')
rep('const lim = L.length > 1 ? 370000 : INLINE_MAX', 'const lim = L.length > 1 ? 8 * 1024 * 1024 : INLINE_MAX')
# 3. lokasi Drive diatur aplikasi (folder "Dokumen Kegiatan S2 MM"), jadi kotaknya disembunyikan
rep('a.btn{text-decoration:none;color:inherit}', 'a.btn{text-decoration:none;color:inherit}\n.fld:has(#lokasiIn){display:none!important}')
# 4. teks yang menyebut claude.ai
T = [
 ('<small>Email dikirim dari akun Gmail yang tersambung di claude.ai. Isian ini dipakai untuk mengingatkan bila akunnya berbeda.</small>',
  '<small>Email dikirim dari akun Google yang tersambung di aplikasi (menu Aplikasi → Akun Google). Isian ini dipakai untuk mengingatkan bila akunnya berbeda.</small>'),
 ('<p>Buka aplikasi ini di claude.ai dalam keadaan masuk akun, lalu muat ulang halaman.</p>',
  '<p>Data di Google Drive belum bisa dibuka${window.__dkInitError ? \' (\' + esc(window.__dkInitError.message || \'\') + \')\' : \'\'}. Periksa koneksi internet, lalu tekan Ctrl+R. Bila masih gagal, buka menu Aplikasi → Akun Google dan masuk ulang.</p>'),
 ('<small style="color:var(--muted)">Agar Operator bisa menyimpan data, akun claude.ai miliknya juga perlu diberi akses <b>Contributor</b> lewat menu Share aplikasi.</small>',
  '<small style="color:var(--muted)">Pengguna bisa masuk dari komputer mana pun yang sudah memasang aplikasi Dokumen Kegiatan.</small>'),
 ('<p>Buka halaman ini di claude.ai dalam keadaan masuk akun agar kegiatan bisa disimpan.</p>',
  '<p>Periksa koneksi internet dan sambungan Google (menu Aplikasi → Akun Google), lalu tekan Ctrl+R.</p>'),
 ('Google Drive tidak bisa dipakai di tampilan ini. Buka artefak ini di claude.ai dalam keadaan masuk akun.',
  'Google Drive belum tersambung. Buka menu Aplikasi → Akun Google.'),
 ('Tombol Unduh tidak aktif di tampilan ini. Buka aplikasi lewat browser (Chrome/Edge) di claude.ai dalam keadaan masuk akun, lalu muat ulang halaman.',
  'Unduhan belum siap. Tekan Ctrl+R untuk memuat ulang aplikasi.'),
 ('Gmail tidak bisa dipakai di tampilan ini. Buka artefak ini di claude.ai dalam keadaan masuk akun, dengan konektor Gmail tersambung.',
  'Gmail belum tersambung. Buka menu Aplikasi → Akun Google.'),
 ('Email keluar dari akun Gmail yang tersambung di claude.ai${kop.emailPengirim ? `, yaitu <b class="mono">${esc(kop.emailPengirim)}</b> bila akun itu yang Anda sambungkan` : \'\'}.',
  'Email keluar dari akun Google yang tersambung di aplikasi${window.__dkInfo?.email ? `, yaitu <b class="mono">${esc(window.__dkInfo.email)}</b>` : \'\'}.'),
 ('`${S} belum tersambung. Tambahkan di claude.ai: Settings → Connectors → ${S}, lalu muat ulang halaman ini.`',
  '`${S} belum tersambung. Buka menu Aplikasi → Akun Google, masuk ke Google, lalu coba lagi.`'),
 ('`Sambungan ${S} kedaluwarsa. Sambungkan ulang di claude.ai: Settings → Connectors → ${S}.`',
  '`Sambungan Google kedaluwarsa. Buka menu Aplikasi → Akun Google, lalu klik Masuk ulang.`'),
 ('`Ada lebih dari satu akun ${S} tersambung. Pilih akunnya saat claude.ai bertanya, lalu coba lagi.`',
  '`${S} meminta pilihan akun. Buka menu Aplikasi → Akun Google, lalu masuk ulang.`'),
 ("dlSay('Tombol Unduh tidak aktif di tampilan ini. Buka aplikasi lewat browser di claude.ai dalam keadaan masuk akun, lalu muat ulang halaman.', true)",
  "dlSay('Unduhan belum siap. Tekan Ctrl+R untuk memuat ulang aplikasi.', true)"),
 ("dlSay('Sebentar lagi muncul jendela konfirmasi dari claude.ai. Klik <b>Download/Simpan</b> di jendela itu.');",
  "dlSay('Pilih lokasi penyimpanan pada jendela <b>Simpan berkas</b> yang muncul.');"),
 ('Sebentar lagi muncul jendela konfirmasi dari claude.ai. Klik <b>Download/Simpan</b> di jendela itu.`',
  'Pilih lokasi penyimpanan pada jendela <b>Simpan berkas</b> yang muncul.`'),
 ("toast('Data aplikasi belum tersambung. Buka aplikasi di claude.ai dalam keadaan masuk akun, lalu muat ulang halaman.', 7000)",
  "toast('Data aplikasi belum tersambung. Periksa internet lalu tekan Ctrl+R.', 7000)"),
 ("toast('Akun claude.ai yang sedang dipakai hanya bisa melihat arsip ini. Masuk dengan akun pemilik, atau minta pemilik memberi akses Contributor/Editor lewat menu Share.', 8000)",
  "toast('Level Anda hanya bisa melihat. Minta Admin mengubah level Anda.', 8000)"),
]
for a, b in T: rep(a, b)
# 5. pustaka PDF disertakan di aplikasi (tidak bergantung pada CDN)
for u, l in [('html2canvas/1.4.1/html2canvas.min.js', 'html2canvas.min.js'), ('jspdf/2.5.1/jspdf.umd.min.js', 'jspdf.umd.min.js'), ('pdf-lib/1.17.1/pdf-lib.min.js', 'pdf-lib.min.js'), ('pdf.js/3.11.174/pdf.worker.min.js', 'pdf.worker.min.js'), ('pdf.js/3.11.174/pdf.min.js', 'pdf.min.js')]:
    s = s.replace('https://cdnjs.cloudflare.com/ajax/libs/' + u, 'app://local/lib/' + l)
assert 'cdnjs.cloudflare.com' not in s
s = s.replace("Berkas sudah diunduh. Cek folder <b>Downloads</b> di komputer Anda (atau ikon unduhan di pojok kanan atas browser).", "Berkas sudah disimpan dan foldernya dibuka.")
s = s.replace("Unduhan dibatalkan: jendela konfirmasi ditutup atau tidak diklik. Klik <b>Unduh</b> lagi, lalu pilih <b>Download/Simpan</b> pada jendela konfirmasi yang muncul.", "Penyimpanan dibatalkan. Klik <b>Unduh</b> lagi bila perlu.")
s = s.replace('Akun claude.ai', 'Akun').replace('akun claude.ai', 'akun').replace('di claude.ai', 'di aplikasi')
left = [m.start() for m in re.finditer(r'claude\.ai', s)]
assert not left, 'masih ada claude.ai di: ' + ', '.join(s[i-60:i+40].replace('\n',' ') for i in left)
out.write_text(s)
print('ok', out, len(s))
