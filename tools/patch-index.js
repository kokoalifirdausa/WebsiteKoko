'use strict';
/*
  Mengubah public/index.html agar memakai komentar & statistik dari server sendiri (bukan Disqus).
  Tampilan situs tidak diubah: hanya bagian komentar dan skrip Disqus yang diganti.

  Pakai:  node tools/patch-index.js            (menambal public/index.html)
          node tools/patch-index.js path/lain.html
  Berkas asli dicadangkan ke  index.backup-sebelum-dinamis.html
*/
const fs = require('fs');
const path = require('path');

const target = path.resolve(process.argv[2] || path.join(__dirname, '..', 'public', 'index.html'));
if (!fs.existsSync(target)) {
  console.error('Berkas tidak ditemukan: ' + target + '\nSalin index.html Anda ke folder "public" dulu.');
  process.exit(1);
}
let html = fs.readFileSync(target, 'utf8');

if (html.includes('dinamis.js')) {
  console.log('index.html sudah ditambal sebelumnya. Tidak ada yang diubah.');
  process.exit(0);
}

const fail = what => {
  console.error('GAGAL: bagian "' + what + '" tidak ditemukan di index.html, jadi tidak ada perubahan yang disimpan.');
  console.error('Kemungkinan struktur file sudah berbeda dari versi yang dikenali. Kirim file Anda ke Claude untuk disesuaikan.');
  process.exit(1);
};

// 1) Kolom komentar: ganti blok Disqus dengan formulir + daftar komentar
const commentRe = /<section class="comment">[\s\S]*?<\/section>/;
if (!commentRe.test(html)) fail('<section class="comment">');
html = html.replace(commentRe, `<section class="comment">
      <h3>Komentar <span class="c-count" id="cCount"></span></h3>
      <form class="c-form" id="cForm" novalidate>
        <input type="text" name="name" id="cName" maxlength="40" placeholder="Nama" aria-label="Nama" required>
        <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        <textarea name="text" id="cText" maxlength="1000" placeholder="Tulis komentar ..." aria-label="Komentar" required></textarea>
        <div class="c-row"><button class="c-submit" type="submit">Kirim</button><span class="c-msg" id="cMsg" role="status"></span></div>
      </form>
      <ul class="c-list" id="cList"></ul>
      <noscript>Aktifkan JavaScript untuk melihat komentar.</noscript>
    </section>`);

// 2) Skrip Disqus: ganti dengan penghubung ke dinamis.js
const disqusRe = /\/\/ ----- Disqus -----[\s\S]*?(?=\s*\/\/ ----- Pindah halaman)/;
if (!disqusRe.test(html)) fail('blok skrip Disqus');
html = html.replace(disqusRe, `// ----- Fitur dinamis: komentar & statistik dari server (lihat dinamis.js) -----
  let currentPage = "beranda";
  function onPageShown() { if (window.KokoDynamic) KokoDynamic.onPage(currentPage); }
`);
html = html.split('loadDisqus').join('onPageShown');

// 3) Muat dinamis.js sebelum skrip utama, dan dinamis.css di <head>
const scriptRe = /<script>(\s*)\/\/ ----- Fitur dinamis/;
if (!scriptRe.test(html)) fail('<script> utama');
html = html.replace(scriptRe, '<script src="dinamis.js"></script>\n<script>$1// ----- Fitur dinamis');
if (!html.includes('</head>')) fail('</head>');
html = html.replace('</head>', '<link rel="stylesheet" href="dinamis.css">\n</head>');

// 4) Bersihkan sisa gaya Disqus (opsional)
html = html.replace(/\n\s*#disqus_thread \.note \{[^}]*\}/, '');

const backup = path.join(path.dirname(target), 'index.backup-sebelum-dinamis.html');
if (!fs.existsSync(backup)) fs.copyFileSync(target, backup);
fs.writeFileSync(target, html);
console.log('Berhasil. index.html sudah memakai komentar & statistik dari server.');
console.log('Cadangan asli: ' + backup);
