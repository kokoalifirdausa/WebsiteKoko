# Koko's Homepage — versi dinamis

Server sendiri (Node.js) dengan **komentar buatan sendiri**, **statistik pengunjung**, dan **panel admin**,
sebagai pengganti Disqus. Tidak perlu `npm install` — hanya memakai modul bawaan Node.js.

## Cara menjalankan

1. Pasang **Node.js versi LTS** dari nodejs.org (minimal versi 18). Cek di terminal: `node -v`
2. Ekstrak folder ini, lalu **salin seluruh isi folder web lama Anda ke folder `public/`**
   (index.html, foto.png, folder cover/, cv.pdf, dan lainnya).
   Jangan menimpa `admin.html`, `dinamis.js`, dan `dinamis.css` yang sudah ada di sana.
3. Buka folder ini di VS Code, lalu di terminal jalankan **sekali saja**:
   ```
   node tools/patch-index.js
   ```
   Skrip ini mengganti bagian komentar Disqus di `public/index.html`. Tampilan lainnya tidak berubah,
   dan berkas asli dicadangkan sebagai `index.backup-sebelum-dinamis.html`.
4. Jalankan server:
   ```
   node server.js
   ```
   Catat **password admin awal** yang tercetak di terminal (hanya tampil sekali).
5. Buka:
   - Website: http://localhost:3000
   - Panel admin: http://localhost:3000/admin

Live Server VS Code tidak dipakai lagi, karena komentar dan statistik membutuhkan server ini.

## Isi panel admin
- **Ringkasan**: tampilan hari ini / 7 hari / total, grafik 14 hari, halaman terpopuler, perangkat, asal pengunjung, kunjungan terbaru.
- **Komentar**: lihat semua, setujui, balas sebagai Admin, hapus.
- **Pengaturan**: nyalakan/matikan moderasi (komentar harus disetujui dulu), ganti password, keluar.

## Data & keamanan
- Data tersimpan di `data/db.json` (salin berkas ini untuk membuat cadangan). Folder `data/` dibuat otomatis.
- Server hanya bisa dibuka dari komputer ini (`127.0.0.1`). Untuk membuka ke jaringan: `HOST=0.0.0.0 node server.js`.
- Password admin disimpan sebagai hash (scrypt). Lupa password: hapus `data/admin.json`, jalankan ulang server.
- Komentar dibatasi 5 per 10 menit per perangkat, ada jebakan bot (honeypot), dan semua teks ditampilkan sebagai teks biasa (aman dari XSS).
- IP pengunjung tidak disimpan; pengunjung unik dihitung dari hash IP + browser + tanggal. Sinyal Do Not Track dihormati.

## Pengaturan lewat variabel lingkungan
`PORT` (bawaan 3000), `HOST` (bawaan 127.0.0.1), `TZ_OFFSET_HOURS` (bawaan 7 untuk WIB), `ADMIN_PASSWORD` (hanya dipakai saat akun admin pertama dibuat).
Contoh (PowerShell): `$env:PORT=3001; node server.js`

## Struktur
```
server.js            server (API, berkas statis, sesi admin)
tools/patch-index.js penambal index.html (dijalankan sekali)
public/              isi website
  admin.html         panel admin
  dinamis.js/.css    komentar & pencatatan kunjungan di sisi pengunjung
data/                dibuat otomatis (db.json, admin.json, secret.txt)
```
