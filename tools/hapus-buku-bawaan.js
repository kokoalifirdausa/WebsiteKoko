'use strict';
// Membuang kartu buku / file yang ditulis manual di public/index.html.
// Materi dari Panel Admin TIDAK terpengaruh (dibuat oleh JavaScript, bukan tertulis di HTML).
// Contoh di dalam komentar HTML <!-- ... --> juga diabaikan.
//
// Pemakaian (jalankan dari folder proyek):
//   node tools/hapus-buku-bawaan.js                  -> hanya menampilkan daftar, tidak mengubah apa pun
//   node tools/hapus-buku-bawaan.js --semua          -> hapus semua
//   node tools/hapus-buku-bawaan.js --judul=104,AoPS -> hapus yang judulnya memuat salah satu kata itu
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'index.html');
const BACKUP = path.join(__dirname, 'index.backup.html');

const html = fs.readFileSync(FILE, 'utf8');
// Komentar HTML diganti spasi (panjang sama) agar tidak ikut terbaca sebagai entri
const masked = html.replace(/<!--[\s\S]*?-->/g, c => ' '.repeat(c.length));
const re = /[ \t]*<li class="(book-card|file-card)"[^>]*>[\s\S]*?<\/li>[ \t]*(?:\r?\n)?/g;

const entries = [];
for (const m of masked.matchAll(re)) {
  const start = m.index, end = m.index + m[0].length;
  const block = html.slice(start, end);
  const title = (block.match(/class="(?:book-title|file-title)">([^<]*)</) || [, '(tanpa judul)'])[1].trim();
  const link = (block.match(/class="btn-book"\s+href="([^"]*)"/) || [, ''])[1];
  entries.push({ start, end, title, link, kind: m[1] === 'book-card' ? 'Olimpiade' : 'Kuliah' });
}

const arg = process.argv.slice(2);
const all = arg.includes('--semua');
const judulArg = arg.find(a => a.startsWith('--judul='));
const keys = judulArg ? judulArg.slice(8).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];

const target = entries.filter(e => all || keys.some(k => e.title.toLowerCase().includes(k)));

console.log(`\nDitemukan ${entries.length} entri yang ditulis manual di index.html:\n`);
entries.forEach((e, i) => {
  const mark = target.includes(e) ? '[HAPUS]' : '[tetap]';
  const placeholder = e.link.includes('GANTI') ? '  (link masih contoh/placeholder)' : '';
  console.log(`${String(i + 1).padStart(2)}. ${mark} ${e.kind}: ${e.title}${placeholder}`);
  console.log(`      link: ${e.link || '-'}`);
});

if (!target.length) {
  console.log('\nBelum ada yang dihapus. Tambahkan --semua atau --judul=kata1,kata2 untuk menghapus.\n');
  process.exit(0);
}

fs.copyFileSync(FILE, BACKUP);
let out = html;
for (const e of [...target].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + out.slice(e.end);
fs.writeFileSync(FILE, out);

console.log(`\n${target.length} entri dihapus. Cadangan file lama: ${path.relative(process.cwd(), BACKUP)}\n`);