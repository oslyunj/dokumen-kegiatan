# Dokumen Kegiatan

Aplikasi dokumentasi kegiatan **Program Studi S2 Magister Manajemen, Fakultas Ekonomi dan Bisnis, Universitas Negeri Jakarta**.
Setiap kegiatan menyimpan undangan, poster, daftar hadir, notulensi, foto, dan berita dalam satu tempat.

Dibuat oleh **Koorprodi Dr. Osly Usman, M.BusSyst**.

## Fitur

- Undangan berkop, daftar hadir, notulensi, rekap kehadiran, dan lampiran foto, semua bisa diunduh sebagai PDF A4
- Kirim undangan dan notulensi lewat Gmail, simpan otomatis ke Google Drive, catat ke Google Calendar dengan pengingat
- Kolom Zoom (tautan, Meeting ID, Passcode) yang otomatis masuk ke surat dan email undangan
- Tab **Berita**: menyusun berita/siaran pers dengan AI (Gemini di Windows, Claude di versi web) dari isian kegiatan dan foto
- Login username dan kata sandi dengan level **Admin**, **Operator**, **Peninjau**
- Data bersama di beberapa komputer melalui Google Drive akun Prodi (mm.febunj@gmail.com)

## Isi repositori

| Folder | Isi |
| --- | --- |
| `desktop/` | Aplikasi Windows (Electron). Kode utama di `desktop/src/`, tampilan di `desktop/src/ui/` |
| `web/` | Versi web (satu berkas HTML) yang berjalan sebagai artefak di claude.ai |
| `.github/workflows/` | Pembuatan installer Windows otomatis |

`desktop/src/ui/index.html` dibuat dari `web/index.html` dengan `desktop/build-ui.py`. Ubah versi web dulu, lalu jalankan:

```bash
cd desktop
python3 build-ui.py ../web/index.html
```

## Membuat installer Windows

**Otomatis (disarankan):** buat tag versi, misalnya `v1.3.1`, lalu push. GitHub Actions membuat
`Dokumen-Kegiatan-Setup-<versi>.exe` dan melampirkannya di halaman **Releases**.
Bisa juga dijalankan manual dari tab **Actions → Build Windows installer → Run workflow**.

**Manual di komputer Windows:**

```bash
cd desktop
npm ci
npx electron-builder --win nsis --x64 --publish never
```

Hasilnya ada di `desktop/dist/`.

## Pengujian

Pengujian memakai server Google dan Gemini tiruan, tanpa menyentuh akun sungguhan:

```bash
cd desktop
node test/mock-google.js &      # server tiruan di port 47123
node test/e2e.js                # dua komputer, Drive, Gmail, login, sinkron
node test/e2e-cal.js            # Google Calendar
node test/e2e-berita.js         # tab Berita (Gemini) termasuk foto
```

## Pemasangan

Panduan lengkap (kredensial Google Cloud, kunci Gemini, akun Admin pertama) ada di dokumen
**Panduan Pemasangan Aplikasi Dokumen Kegiatan (Windows)**.

Kredensial Google (`client_secret_*.json`) dan kunci Gemini **tidak pernah** disimpan di repositori ini.
Keduanya dipasang langsung di setiap komputer dan disimpan terenkripsi di sana.

## Pustaka pihak ketiga

`desktop/src/ui/lib/` berisi pdf-lib (MIT), html2canvas (MIT), jsPDF (MIT), dan PDF.js (Apache-2.0),
disertakan agar pembuatan PDF tidak bergantung pada internet.
