'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- Konfigurasi ----------
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.txt');

const MAX_BODY = 20 * 1024;             // 20 KB untuk request biasa
const MAX_UPLOAD_BODY = 25 * 1024 * 1024; // 25 MB untuk upload file & cover
const SESSION_MS = 8 * 3600 * 1000;     // Sesi admin 8 jam

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- Penyimpanan Data (JSON Atomik) ----------
let db = { nextId: 1, items: [] };
try {
  const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db = {
    nextId: raw.nextId || 1,
    items: Array.isArray(raw.items) ? raw.items : []
  };
} catch (e) {
  if (e.code !== 'ENOENT') {
    console.error('db.json rusak, dicadangkan ke db.json.bak:', e.message);
    try { fs.copyFileSync(DB_FILE, DB_FILE + '.bak'); } catch (_) {}
  }
}

let dirty = false, saveTimer = null;
function save() { dirty = true; if (!saveTimer) saveTimer = setTimeout(flush, 300); }
function flush() {
  saveTimer = null;
  if (!dirty) return;
  dirty = false;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- Rahasia Server & Akun Admin ----------
let SECRET;
try { SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim(); }
catch (_) { SECRET = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(SECRET_FILE, SECRET); }

const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
let admin;
try { admin = JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8')); }
catch (_) {
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  admin = { salt, hash: hashPw(pw, salt) };
  fs.writeFileSync(ADMIN_FILE, JSON.stringify(admin));
  console.log('\n============================================================');
  console.log(' Akun admin dibuat. Password awal (catat, hanya tampil sekali):');
  console.log('   ' + pw);
  console.log(' Ganti di panel admin > Pengaturan. Lupa? Hapus data/admin.json lalu restart.');
  console.log('============================================================\n');
}

function checkPw(pw) {
  const a = Buffer.from(hashPw(pw, admin.salt), 'hex');
  const b = Buffer.from(admin.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Utilitas & Keamanan ----------
const sessions = new Map();
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return true; }
  arr.push(now); buckets.set(key, arr);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of buckets) if (!arr.length || now - arr[arr.length - 1] > 3600e3) buckets.delete(k);
  for (const [t, s] of sessions) if (s.exp < now) sessions.delete(t);
}, 600e3).unref();

const clientIp = req => req.socket.remoteAddress || 'unknown';
function clean(s, max) {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n').trim().slice(0, max);
}
const httpErr = (status, message) => Object.assign(new Error(message), { status });

// CSP mengizinkan Disqus serta font Google
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer-when-downgrade',
  'Permissions-Policy': 'unload=()',
  'Content-Security-Policy': "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://*.disqus.com https://c.disquscdn.com https://d-code.liadm.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://c.disquscdn.com; " +
    "font-src 'self' https://fonts.gstatic.com https://c.disquscdn.com; " +
    "img-src 'self' data: https: http:; " +
    "connect-src 'self' https://*.disqus.com https://links.services.disqus.com; " +
    "frame-src https://disqus.com https://*.disqus.com; " +
    "form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};

function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  const type = isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';
  res.writeHead(status, { ...SEC_HEADERS, 'Content-Type': type, ...(isObj ? { 'Cache-Control': 'no-store' } : {}), ...headers });
  res.end(data);
}

function readJson(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, tooBig = false;
    req.on('data', c => {
      size += c.length;
      if (size > limit) tooBig = true;
      else chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return reject(httpErr(413, 'Ukuran file terlalu besar (maksimal 25 MB)'));
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (_) { reject(httpErr(400, 'Format JSON tidak valid')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(h) {
  const out = {};
  String(h || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (_) {} }
  });
  return out;
}

function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch (_) { return false; }
}

function requireAdmin(req) {
  const sid = parseCookies(req.headers.cookie).sid;
  const s = sid && sessions.get(sid);
  if (!s || s.exp < Date.now()) throw httpErr(401, 'Belum login');
  if (req.method !== 'GET') {
    if (req.headers['x-requested-with'] !== 'fetch' || !sameOrigin(req)) throw httpErr(403, 'Permintaan ditolak');
  }
  return sid;
}

// Menyimpan file base64 dari browser ke folder public/uploads/
function saveBase64File(dataUrl, allowedExts, prefix) {
  if (!dataUrl || typeof dataUrl !== 'string') return '';
  const match = dataUrl.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
  if (!match) return '';
  const mime = match[1].toLowerCase();
  const extMap = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/zip': '.zip'
  };
  const ext = extMap[mime];
  if (!ext || !allowedExts.includes(ext)) {
    throw httpErr(400, `Tipe file tidak diizinkan (${mime})`);
  }
  const buf = Buffer.from(match[2], 'base64');
  const filename = `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
  return 'uploads/' + filename;
}

function removeUploadedFile(relPath) {
  if (!relPath || !relPath.startsWith('uploads/')) return;
  const full = path.normalize(path.join(PUBLIC_DIR, relPath));
  if (full.startsWith(UPLOAD_DIR + path.sep)) {
    try { fs.unlinkSync(full); } catch (_) {}
  }
}

// ---------- API ----------
async function handleApi(req, res, url) {
  const p = url.pathname, m = req.method;

  // --- Publik: ambil daftar materi / buku ---
  if (p === '/api/items' && m === 'GET') {
    return send(res, 200, { items: db.items });
  }

  // --- Admin: login ---
  if (p === '/api/admin/login' && m === 'POST') {
    if (req.headers['x-requested-with'] !== 'fetch' || !sameOrigin(req)) throw httpErr(403, 'Permintaan ditolak');
    if (limited('l:' + clientIp(req), 8, 10 * 60e3)) throw httpErr(429, 'Terlalu banyak percobaan. Coba 10 menit lagi.');
    const b = await readJson(req);
    if (!checkPw(b.password ?? '')) throw httpErr(401, 'Password salah');
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, { exp: Date.now() + SESSION_MS });
    return send(res, 200, { ok: true }, { 'Set-Cookie': `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}` });
  }

  // --- Admin: endpoint terproteksi ---
  if (p.startsWith('/api/admin/')) {
    const sid = requireAdmin(req);

    if (p === '/api/admin/me' && m === 'GET') return send(res, 200, { ok: true });
    if (p === '/api/admin/logout' && m === 'POST') {
      sessions.delete(sid);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }

    // Ambil semua item di panel admin
    if (p === '/api/admin/items' && m === 'GET') {
      return send(res, 200, { items: [...db.items].reverse() });
    }

    // Tambah / upload materi baru
    if (p === '/api/admin/items' && m === 'POST') {
      const b = await readJson(req, MAX_UPLOAD_BODY);
      const section = clean(b.section, 20); // 'olimpiade' | 'kuliah'
      if (!['olimpiade', 'kuliah'].includes(section)) throw httpErr(400, 'Bagian halaman tidak valid');

      const title = clean(b.title, 150);
      if (!title) throw httpErr(400, 'Judul wajib diisi');

      const author = clean(b.author, 150);
      const badge = clean(b.badge, 12) || title.slice(0, 4).toUpperCase();

      // Kategori khusus Olimpiade atau Kuliah
      const topic = clean(b.topic, 30);      // teobil, aljabar, geo, kombin, problem-solving
      const sem = clean(b.sem, 10);          // 1, 2, 3, ..., luar
      const jenis = clean(b.jenis, 20);      // buku, ppt, soal, exercise
      const subject = clean(b.subject, 100); // Mata kuliah (mis. Kalkulus 1)

      // Tangani file utama (upload file ATAU link eksternal)
      let fileUrl = '';
      if (b.fileData) {
        fileUrl = saveBase64File(b.fileData, ['.pdf', '.ppt', '.pptx', '.zip'], 'doc');
      } else {
        fileUrl = clean(b.externalUrl, 500);
        if (fileUrl && !/^https?:\/\//i.test(fileUrl)) {
          throw httpErr(400, 'Link eksternal harus diawali http:// atau https://');
        }
      }
      if (!fileUrl) throw httpErr(400, 'Wajib mengunggah file atau mengisi link Google Drive');

      // Tangani gambar sampul (opsional)
      let coverUrl = '';
      if (b.coverData) {
        coverUrl = saveBase64File(b.coverData, ['.jpg', '.png', '.webp'], 'cov');
      }

      const item = {
        id: db.nextId++,
        section,
        topic,
        sem,
        jenis,
        subject,
        title,
        author,
        badge,
        fileUrl,
        coverUrl,
        createdAt: new Date().toISOString()
      };
      db.items.push(item);
      save();
      return send(res, 201, { ok: true, item });
    }

    // Hapus materi & file terkait
    let mt;
    if ((mt = p.match(/^\/api\/admin\/items\/(\d+)$/)) && m === 'DELETE') {
      const id = Number(mt[1]);
      const idx = db.items.findIndex(x => x.id === id);
      if (idx === -1) throw httpErr(404, 'Data tidak ditemukan');
      const [removed] = db.items.splice(idx, 1);
      removeUploadedFile(removed.fileUrl);
      removeUploadedFile(removed.coverUrl);
      save();
      return send(res, 200, { ok: true });
    }

    // Ganti password admin
    if (p === '/api/admin/password' && m === 'POST') {
      if (limited('pw:' + clientIp(req), 8, 10 * 60e3)) throw httpErr(429, 'Terlalu banyak percobaan');
      const b = await readJson(req);
      if (!checkPw(b.current ?? '')) throw httpErr(403, 'Password saat ini salah');
      const next = String(b.next ?? '');
      if (next.length < 8) throw httpErr(400, 'Password baru minimal 8 karakter');
      const salt = crypto.randomBytes(16).toString('hex');
      admin = { salt, hash: hashPw(next, salt) };
      fs.writeFileSync(ADMIN_FILE, JSON.stringify(admin));
      return send(res, 200, { ok: true });
    }
  }

  throw httpErr(404, 'Endpoint tidak ditemukan');
}

// ---------- Berkas Statis ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

function serveStatic(req, res, pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch (_) { return send(res, 400, 'Permintaan tidak valid'); }
  if (p === '/') p = '/index.html';
  if (p === '/admin') p = '/admin.html';
  if (p.includes('\0')) return send(res, 400, 'Permintaan tidak valid');
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Dilarang');
  if (path.relative(PUBLIC_DIR, file).split(path.sep).some(s => s.startsWith('.'))) return send(res, 404, 'Tidak ditemukan');

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Tidak ditemukan');
    const ext = path.extname(file).toLowerCase();
    const extra = {
      'Content-Length': st.size,
      'Cache-Control': ['.html', '.js', '.css'].includes(ext) ? 'no-cache' : 'public, max-age=3600'
    };
    if (p === '/admin.html') extra['X-Robots-Tag'] = 'noindex';
    res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': MIME[ext] || 'application/octet-stream', ...extra });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  try {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (_) { throw httpErr(400, 'Permintaan tidak valid'); }
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Metode tidak diizinkan');
    serveStatic(req, res, url.pathname);
  } catch (e) {
    if (e.status) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Terjadi kesalahan pada server' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Server berjalan di  http://localhost:${PORT}`);
  console.log(`Panel admin di      http://localhost:${PORT}/admin`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flush(); process.exit(0); });
