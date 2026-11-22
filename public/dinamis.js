/* Fitur dinamis untuk index.html: komentar dan pencatatan kunjungan, terhubung ke server.js */
(function () {
  "use strict";
  var live = location.protocol === "http:" || location.protocol === "https:";
  var last = null;      // halaman terakhir yang sudah dicatat kunjungannya
  var current = null;   // halaman yang sedang tampil
  var firstTrack = true;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // textContent: aman dari XSS
    return n;
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = { "X-Requested-With": "fetch" };
    if (opts.body) headers["Content-Type"] = "application/json";
    return fetch("/api" + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || "Terjadi kesalahan"); e.status = r.status; throw e; }
        return d;
      });
    });
  }

  // ---------- Statistik kunjungan ----------
  function track(page) {
    if (!live || navigator.doNotTrack === "1") return;
    var ref = "";
    if (firstTrack) {
      try {
        if (document.referrer) { var h = new URL(document.referrer).host; if (h !== location.host) ref = h; }
      } catch (e) { /* abaikan */ }
      firstTrack = false;
    }
    try {
      fetch("/api/track", {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
        body: JSON.stringify({ page: page, ref: ref })
      }).catch(function () {});
    } catch (e) { /* abaikan */ }
  }

  // ---------- Komentar ----------
  function msg(text, isErr) {
    var m = $("cMsg");
    if (!m) return;
    m.textContent = text || "";
    m.className = "c-msg" + (isErr ? " err" : "");
  }
  function fmt(iso) {
    try {
      return new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) { return iso; }
  }
  function item(c) {
    var li = el("li", "c-item");
    var head = el("div", "c-head");
    head.appendChild(el("strong", "c-name", c.name));
    if (c.isAdmin) head.appendChild(el("span", "c-badge", "Admin"));
    head.appendChild(el("time", "c-time", fmt(c.createdAt)));
    li.appendChild(head);
    li.appendChild(el("p", "c-text", c.text));
    return li;
  }
  function render(items) {
    var list = $("cList");
    if (!list) return;
    list.textContent = "";
    var byNew = function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; };
    var byOld = function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; };
    var tops = items.filter(function (i) { return !i.parentId; }).sort(byNew);
    var replies = items.filter(function (i) { return i.parentId; });
    tops.forEach(function (c) {
      var li = item(c);
      var rs = replies.filter(function (r) { return r.parentId === c.id; }).sort(byOld);
      if (rs.length) {
        var ul = el("ul", "c-replies");
        rs.forEach(function (r) { ul.appendChild(item(r)); });
        li.appendChild(ul);
      }
      list.appendChild(li);
    });
    $("cCount").textContent = items.length ? "(" + items.length + ")" : "";
    if (!tops.length) list.appendChild(el("li", "c-empty", "Belum ada komentar. Jadilah yang pertama!"));
  }

  function loadComments(page) {
    if (!$("cList")) return;
    if (!live) {
      $("cList").textContent = "";
      msg("Komentar membutuhkan server. Jalankan: node server.js, lalu buka http://localhost:3000", true);
      return;
    }
    api("/comments?page=" + encodeURIComponent(page)).then(function (d) {
      if (page !== current) return;   // abaikan jawaban lama kalau pengunjung sudah pindah halaman
      render(d.items);
    }).catch(function () {
      msg("Komentar tidak dapat dimuat. Pastikan server berjalan.", true);
    });
  }

  function bindForm() {
    var f = $("cForm");
    if (!f) return;
    var nameInput = $("cName");
    try { var saved = localStorage.getItem("koko_name"); if (saved) nameInput.value = saved; } catch (e) { /* abaikan */ }

    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!live) { msg("Komentar membutuhkan server. Jalankan: node server.js", true); return; }
      if (!current || current === "beranda") return;
      var name = nameInput.value.trim(), text = $("cText").value.trim();
      if (!name || !text) { msg("Nama dan komentar wajib diisi.", true); return; }
      var btn = f.querySelector(".c-submit");
      btn.disabled = true; msg("Mengirim...");
      api("/comments", { method: "POST", body: { page: current, name: name, text: text, website: f.elements.website.value } })
        .then(function (d) {
          try { localStorage.setItem("koko_name", name); } catch (e) { /* abaikan */ }
          $("cText").value = "";
          msg(d.status === "pending" ? "Terima kasih! Komentar Anda akan tampil setelah disetujui admin." : "Komentar terkirim.");
          loadComments(current);
        })
        .catch(function (err) { msg(err.message, true); })
        .then(function () { btn.disabled = false; });
    });
  }

  // Dipanggil oleh index.html setiap kali halaman berganti
  window.KokoDynamic = {
    onPage: function (page) {
      current = page;
      if (page !== last) { last = page; track(page); }   // catat kunjungan hanya saat halaman benar-benar berganti
      if (page !== "beranda") loadComments(page);
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindForm);
  else bindForm();
})();
