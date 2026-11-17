// Tampilan katalog + widget chatbot.
// Data produk dibaca dari /data.json (dibuat oleh: npm run build-data).
// Pertanyaan chatbot dikirim ke /api/chat (lib/chat.js -> RAG + Groq).

const state = {
  data: null,
  kategori: "Semua",
  kandungan: null,
  cari: "",
  urut: "terlaris",
  history: []
};

// Kandungan khas yang dicari dari nama produk, untuk "tabel periodik" di hero
const ACTIVES = [
  { sym: "Cr", nama: "Ceramide", re: /ceramide/i },
  { sym: "Nc", nama: "Niacinamide", re: /niacinamide|ncnmd/i },
  { sym: "Mw", nama: "Mugwort", re: /mugwort/i },
  { sym: "Ha", nama: "Hyaluronic acid", re: /hyaluronic/i },
  { sym: "Sa", nama: "Salicylic acid", re: /salicylic|\bbha\b/i },
  { sym: "Rt", nama: "Retinol", re: /retinol/i },
  { sym: "Pn", nama: "Panthenol", re: /panthenol/i },
  { sym: "Ct", nama: "Centella", re: /centella|\bcica\b/i },
  { sym: "Pp", nama: "Peptide", re: /peptide/i },
  { sym: "Tx", nama: "Tranexamic acid", re: /tranexamic/i },
  { sym: "Sw", nama: "Symwhite 377", re: /symwhite/i },
  { sym: "Ec", nama: "Ectoin", re: /ectoin/i },
  { sym: "Tf", nama: "Truffle", re: /truffle/i },
  { sym: "La", nama: "AHA / lactic", re: /\baha\b|lactic|glycolic/i },
  { sym: "Vc", nama: "Vitamin C", re: /vitamin\s?c\b|\bvit\s?c\b/i },
  { sym: "Uv", nama: "SPF", re: /\bspf/i }
];

const $ = sel => document.querySelector(sel);
const rupiah = n => (n == null ? "-" : "Rp" + Math.round(n).toLocaleString("id-ID"));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------- WhatsApp ----------------
function waLink(text) {
  const nomor = String(state.data?.toko?.whatsapp || "").replace(/[^\d]/g, "");
  return `https://wa.me/${nomor}?text=${encodeURIComponent(text)}`;
}

function fillTemplate(tpl, p) {
  const toko = state.data?.toko?.nama || "";
  return String(tpl)
    .replace(/\{toko\}/g, toko)
    .replace(/\{nama\}/g, p ? p.nama : "")
    .replace(/\{harga\}/g, p ? rupiah(p.harga) : "")
    .replace(/\{kategori\}/g, p ? p.kategori : "")
    .replace(/\{link\}/g, p ? p.link || "" : "");
}

// Template pesan dipilih sesuai kategori produk (lihat data/knowledge.json -> template_wa)
function waTemplate(p) {
  const tpl = state.data.template_wa || {};
  return fillTemplate(tpl[p.kategori] || tpl.default || "Halo {toko}, saya tertarik dengan {nama} ({harga}).", p);
}

// ---------------- Katalog ----------------
// Kalau foto dari Shopee gagal dimuat, tampilkan huruf awal nama produk
window.imgFallback = (img, cls = "card__ph") => {
  const ph = document.createElement("div");
  ph.className = cls;
  ph.textContent = img.dataset.initial || "";
  img.replaceWith(ph);
};
// Huruf pengganti foto: kata pertama setelah nama brand (misalnya "5X", "Mug")
const initialOf = nama => {
  const brand = state.data?.toko?.brand || "";
  const rest = nama.replace(new RegExp(brand, "ig"), "").replace(/^[\s\-–|:]+/, "").trim();
  return (rest.split(/\s+/)[0] || nama.charAt(0)).slice(0, 3);
};

function filtered() {
  const { produk } = state.data;
  const q = state.cari.trim().toLowerCase();
  const active = ACTIVES.find(a => a.sym === state.kandungan);
  let list = produk.filter(p =>
    (state.kategori === "Semua" || p.kategori === state.kategori) &&
    (!active || active.re.test(p.nama)) &&
    (!q || p.nama.toLowerCase().includes(q) || p.kategori.toLowerCase().includes(q))
  );
  const sorters = {
    terlaris: (a, b) => (b.terjual || 0) - (a.terjual || 0),
    termurah: (a, b) => a.harga - b.harga,
    termahal: (a, b) => b.harga - a.harga,
    rating: (a, b) => (b.rating || 0) - (a.rating || 0) || (b.terjual || 0) - (a.terjual || 0),
    diskon: (a, b) => (b.diskon || 0) - (a.diskon || 0)
  };
  return list.slice().sort(sorters[state.urut]);
}

function cardHTML(p) {
  const media = p.gambar
    ? `<img src="${esc(p.gambar)}" alt="${esc(p.nama)}" loading="lazy" referrerpolicy="no-referrer" data-initial="${esc(initialOf(p.nama))}" onerror="imgFallback(this)">`
    : `<div class="card__ph">${esc(initialOf(p.nama))}</div>`;
  const meta = [
    p.rating ? `<span><span class="star" aria-hidden="true">★</span> ${p.rating}</span>` : "",
    p.terjual_teks ? `<span>${esc(p.terjual_teks)} terjual</span>` : ""
  ].join("");
  return `
    <article class="card">
      <div class="card__media">
        ${media}
        ${p.diskon ? `<span class="badge">-${p.diskon}%</span>` : ""}
      </div>
      <div class="card__body">
        <span class="card__cat">${esc(p.kategori)}</span>
        <h3 class="card__name" title="${esc(p.nama)}">${esc(p.nama)}</h3>
        <div class="card__price">
          <strong>${rupiah(p.harga)}</strong>
          ${p.harga_asli ? `<s>${rupiah(p.harga_asli)}</s>` : ""}
        </div>
        <div class="card__meta">${meta}</div>
        <div class="card__actions">
          <a class="btn btn--ghost btn--sm" href="${esc(waLink(waTemplate(p)))}" target="_blank" rel="noopener">Tanya via WA</a>
          <a class="btn btn--solid btn--sm" href="${esc(p.link || state.data.toko.shopee_url)}" target="_blank" rel="noopener">Beli di Shopee</a>
        </div>
      </div>
    </article>`;
}

function renderGrid() {
  const list = filtered();
  $("#productGrid").innerHTML = list.map(cardHTML).join("");
  $("#emptyState").hidden = list.length > 0;
  $("#resultCount").textContent = `${list.length} dari ${state.data.produk.length} produk`;

  const active = ACTIVES.find(a => a.sym === state.kandungan);
  const box = $("#activeFilter");
  if (active) {
    box.hidden = false;
    box.innerHTML = `<span>Kandungan: <strong>${esc(active.nama)}</strong></span><button type="button" id="clearActive">Hapus filter</button>`;
    $("#clearActive").onclick = () => { state.kandungan = null; renderActives(); renderGrid(); };
  } else {
    box.hidden = true;
  }
}

function renderChips() {
  const { kategori, produk } = state.data;
  const all = [{ nama: "Semua", jumlah: produk.length }, ...kategori];
  $("#categoryChips").innerHTML = all.map(k =>
    `<button type="button" class="chip" data-kat="${esc(k.nama)}" aria-pressed="${k.nama === state.kategori}">${esc(k.nama)}<span class="chip__n">${k.jumlah}</span></button>`
  ).join("");
  $("#categoryChips").querySelectorAll(".chip").forEach(btn => {
    btn.onclick = () => { state.kategori = btn.dataset.kat; renderChips(); renderGrid(); };
  });
}

function renderActives() {
  const { produk } = state.data;
  const counted = ACTIVES
    .map(a => ({ ...a, n: produk.filter(p => a.re.test(p.nama)).length }))
    .filter(a => a.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 12);
  if (counted.length < 4) { $("#activesBox").hidden = true; return; }
  $("#activesBox").hidden = false;
  $("#activesGrid").innerHTML = counted.map(a => `
    <button type="button" class="element" data-sym="${a.sym}" aria-pressed="${state.kandungan === a.sym}"
      aria-label="${esc(a.nama)}, ${a.n} produk">
      <span class="element__count">${a.n}</span>
      <span class="element__sym">${a.sym}</span>
      <span class="element__name">${esc(a.nama)}</span>
    </button>`).join("");
  $("#activesGrid").querySelectorAll(".element").forEach(btn => {
    btn.onclick = () => {
      state.kandungan = state.kandungan === btn.dataset.sym ? null : btn.dataset.sym;
      renderActives();
      renderGrid();
      document.getElementById("catalogTitle").scrollIntoView({ behavior: "smooth", block: "start" });
    };
  });
}

function renderHeader() {
  const { toko, produk, kategori, meta } = state.data;
  const brand = toko.brand || "SKINTIFIC";
  const namaToko = toko.nama || brand;
  $("#brand").textContent = brand;
  $("#shopName").textContent = namaToko.replace(new RegExp(`^${brand}\\s*`, "i"), "") || "Lapak Shopee";
  $("#heroBrand").textContent = brand;
  $("#chatBrand").textContent = brand;
  $("#btnShopee").href = toko.shopee_url;
  $("#btnWaHeader").href = waLink(fillTemplate(state.data.template_wa?.umum || "Halo {toko}, saya mau tanya produk.", null));

  const hargaMin = Math.min(...produk.map(p => p.harga));
  $("#heroLead").textContent =
    `${produk.length} produk dalam ${kategori.length} kategori, harga mulai ${rupiah(hargaMin)}. ` +
    `Tanya asistennya soal jenis kulit, masalah kulit, atau budget, jawabannya diambil dari data produk lapak ini.`;

  const tgl = new Date(meta.dibuat).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  $("#footerSource").innerHTML =
    `Data ${produk.length} produk diambil dari <a href="${esc(toko.shopee_url)}" target="_blank" rel="noopener">lapak ${esc(namaToko)} di Shopee</a> dengan Instant Data Scraper, diperbarui ${tgl}.`;
  document.title = `Katalog ${namaToko} + Asisten RAG`;
}

// ---------------- Chatbot ----------------
function formatBot(text) {
  let html = esc(text);
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(\S(?:.*?\S)?)\*/g, "<strong>$1</strong>");
  html = html.replace(/(https?:\/\/[^\s<]+)/g, url => {
    const clean = url.replace(/[).,]+$/, "");
    const tail = url.slice(clean.length);
    const label = /shopee\.co\.id\/.+-i\.\d+\.\d+/.test(clean) ? "Lihat di Shopee" : (clean.length > 46 ? clean.slice(0, 44) + "…" : clean);
    return `<a href="${clean}" target="_blank" rel="noopener">${label}</a>${tail}`;
  });
  return html.replace(/\n/g, "<br>");
}

function miniCards(produk) {
  if (!produk || !produk.length) return "";
  return `<div class="mini">${produk.map(p => `
    <a href="${esc(p.link || state.data.toko.shopee_url)}" target="_blank" rel="noopener">
      ${p.gambar ? `<img src="${esc(p.gambar)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="imgFallback(this, 'mini__ph')">` : `<span class="mini__ph"></span>`}
      <span><span class="mini__name">${esc(p.nama)}</span><span class="mini__price">${rupiah(p.harga)}</span></span>
    </a>`).join("")}</div>`;
}

function metaLine(res) {
  if (res.sumber === "rag+llm") {
    const n = res.debug?.jumlahKonteks ?? 0;
    return `Dijawab dari ${n} produk yang relevan, model ${esc(res.model)}`;
  }
  if (res.sumber === "faq") return "Dijawab dari FAQ toko";
  if (res.sumber && res.sumber.startsWith("rag-cadangan")) return "Jawaban langsung dari data katalog (tanpa AI)";
  return "";
}

function addMessage(role, html, extra = "") {
  const div = document.createElement("div");
  div.className = `msg msg--${role}`;
  div.innerHTML = html + extra;
  $("#chatLog").appendChild(div);
  $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
  return div;
}

async function sendMessage(text) {
  text = text.trim();
  if (!text) return;
  $("#chatSuggest").hidden = true;
  addMessage("user", esc(text));
  $("#chatInput").value = "";
  $("#chatSend").disabled = true;
  const typing = addMessage("bot msg--typing", "Mencari di katalog…");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: state.history })
    }).then(r => r.json());
    typing.remove();
    const meta = metaLine(res);
    addMessage("bot", formatBot(res.reply), miniCards(res.produk) + (meta ? `<p class="msg__meta">${meta}</p>` : ""));
    state.history.push({ role: "user", content: text }, { role: "assistant", content: res.reply });
    state.history = state.history.slice(-8);
  } catch (err) {
    typing.remove();
    addMessage("bot", "Asisten tidak bisa dihubungi. Periksa koneksi internet lalu kirim ulang pertanyaannya.");
  } finally {
    $("#chatSend").disabled = false;
    $("#chatInput").focus();
  }
}

function openChat() {
  $("#chatPanel").hidden = false;
  $("#chatFab").setAttribute("aria-expanded", "true");
  if (!$("#chatLog").children.length) {
    const brand = state.data?.toko?.brand || "SKINTIFIC";
    addMessage("bot", formatBot(`Halo Kak! Aku bisa bantu cari produk ${brand} sesuai jenis kulit, masalah kulit, atau budget. Mau cari apa?`));
  }
  $("#chatInput").focus();
}

function closeChat() {
  $("#chatPanel").hidden = true;
  $("#chatFab").setAttribute("aria-expanded", "false");
  $("#chatFab").focus();
}

// ---------------- Mulai ----------------
async function init() {
  document.querySelectorAll("[data-open-chat]").forEach(b => b.addEventListener("click", openChat));
  $("#chatClose").addEventListener("click", closeChat);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#chatPanel").hidden) closeChat(); });
  $("#chatForm").addEventListener("submit", e => { e.preventDefault(); sendMessage($("#chatInput").value); });
  $("#chatSuggest").querySelectorAll("button").forEach(b => b.addEventListener("click", () => sendMessage(b.textContent)));
  $("#searchInput").addEventListener("input", e => { state.cari = e.target.value; renderGrid(); });
  $("#sortSelect").addEventListener("change", e => { state.urut = e.target.value; renderGrid(); });

  try {
    state.data = await fetch("data.json", { cache: "no-store" }).then(r => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  } catch (err) {
    $("#heroLead").textContent = "Data katalog belum ada. Jalankan npm run build-data lalu muat ulang halaman ini.";
    return;
  }
  renderHeader();
  renderActives();
  renderChips();
  renderGrid();
}

init();
