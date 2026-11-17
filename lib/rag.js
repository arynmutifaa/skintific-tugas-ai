// Mesin RAG (bagian "Retrieval").
// Tugasnya: dari pertanyaan pembeli, cari produk yang paling relevan di data
// hasil scraping, lalu susun jadi teks konteks untuk dikirim ke LLM (Groq).
//
// Pencarian sengaja dibuat sederhana dan bisa dijelaskan: berbasis kata kunci + skor,
// tanpa embedding. Supaya tetap "pintar" untuk skincare, ada tambahan:
//   - deteksi kategori ("sunscreen", "pelembab", "sabun cuci muka", ...)
//   - deteksi masalah kulit ("jerawat", "kusam", "berminyak", ...) yang diterjemahkan
//     ke kata yang biasa muncul di nama produk (acne, niacinamide, matte, ...)
//   - deteksi maksud: termurah, termahal, terlaris, rating, diskon, semua produk
//   - batas harga: "di bawah 100rb", "maks 150.000", "budget 80k"
//   - toleransi salah ketik ringan ("niacinamid" -> "niacinamide")

const kategoriConfig = require("../data/kategori.json");
const { keywordMatcher } = require("./normalize");

let PRODUCTS = [];
try {
  PRODUCTS = require("../data/products.json").produk || [];
} catch (err) {
  console.warn("[RAG] data/products.json belum ada. Jalankan: npm run build-data");
}

const TOP_K = Number(process.env.RAG_TOP_K || 8);

// Kata yang tidak dipakai untuk mencari (terlalu umum)
const STOPWORDS = new Set(`
  yang yg ada apa aja saja dong deh sih kak kakak min admin mimin gan sis bang mau pengen pingin ingin
  cari carikan nyari tolong bantu minta kasih kasi tau tahu info informasi ini itu tsb tersebut untuk buat
  bwt utk dan atau di ke dari dengan dgn sama yang mana mana gimana bagaimana kenapa kok bisa boleh
  tanya nanya punya ya iya ok oke oh ga gak nggak ngga enggak tidak bukan belum udah sudah lagi juga
  aku saya gue gw kamu anda kalian kita kami nya produk produknya barang item skincare skin care
  skintific brand toko lapak shopee jual dijual berapa harga harganya biaya link linknya url nya
  rekomendasi rekomen recommend saran sarankan cocok bagus yang bagus paling sangat banget bgt
  terbaik best good wajah muka kulit kulitku kulit ku jenis tipe type pakai pake dipakai cara
  kalau kalo klo terus trus lalu tadi td itu dia mereka the for and with of a an to
`.trim().split(/\s+/));

// Masalah kulit -> kata yang biasa ada di nama produk Skintific
const CONCERNS = [
  { nama: "jerawat", pemicu: ["jerawat", "berjerawat", "jerawatan", "acne", "breakout", "beruntusan", "bruntusan", "pimple"],
    cari: ["acne", "salicylic", "mugwort", "bha", "acids", "jerawat", "tea tree", "centella", "clear"] },
  { nama: "kusam / mencerahkan", pemicu: ["kusam", "cerah", "mencerahkan", "pencerah", "glowing", "glow", "brightening", "bright", "dull"],
    cari: ["bright", "brightening", "niacinamide", "symwhite", "tranexamic", "vitamin c", "glow", "radiance", "pencerah"] },
  { nama: "flek / noda hitam", pemicu: ["flek", "noda", "bekas jerawat", "dark spot", "pih", "pie", "hiperpigmentasi", "melasma"],
    cari: ["dark spot", "spot", "symwhite", "tranexamic", "niacinamide", "bright"] },
  { nama: "kulit kering / dehidrasi", pemicu: ["kering", "dehidrasi", "dehydrated", "dry", "mengelupas", "melembapkan", "melembabkan", "hidrasi", "hydrating"],
    cari: ["moisture", "hyaluronic", "ceramide", "hydrating", "hydra", "aqua", "barrier", "moisturizer"] },
  { nama: "kulit berminyak", pemicu: ["berminyak", "minyak", "oily", "oil control", "kilap"],
    cari: ["oil", "matte", "mugwort", "clay", "salicylic", "pore", "pores", "light", "control"] },
  { nama: "pori-pori / komedo", pemicu: ["pori", "pori-pori", "komedo", "blackhead", "whitehead", "pores"],
    cari: ["pore", "pores", "clay", "salicylic", "bha", "peeling", "mugwort", "blackhead"] },
  { nama: "kulit sensitif / kemerahan", pemicu: ["sensitif", "sensitive", "kemerahan", "merah", "iritasi", "redness", "perih"],
    cari: ["sensitive", "soothe", "soothing", "ceramide", "panthenol", "centella", "calming", "gentle", "cica"] },
  { nama: "skin barrier", pemicu: ["barrier", "skin barrier", "rusak"],
    cari: ["barrier", "ceramide", "repair", "panthenol"] },
  { nama: "penuaan / garis halus", pemicu: ["kerutan", "keriput", "garis halus", "aging", "anti aging", "penuaan", "wrinkle", "kencang"],
    cari: ["retinol", "peptide", "aging", "wrinkle", "renewal", "lifting", "bakuchiol", "collagen", "firming"] },
  { nama: "area mata", pemicu: ["mata panda", "kantung mata", "lingkar hitam", "mata"],
    cari: ["eye"] }
];

// Kata di pertanyaan -> kategori (nama kategori harus sama dengan data/kategori.json)
const CATEGORY_ALIASES = {
  "Paket Hemat": ["paket", "bundle", "bundling", "set", "duo", "trio", "combo", "kit"],
  "Bibir": ["lip", "lips", "bibir", "lipstik", "lipstick", "lip balm", "lip serum", "lip tint"],
  "Masker": ["masker", "mask", "clay mask", "maskeran", "clay"],
  "Pembersih": ["cleanser", "pembersih", "sabun cuci muka", "sabun muka", "cuci muka", "facial wash", "face wash", "facial foam", "micellar", "cleansing", "cleansing balm", "pencuci muka"],
  "Makeup": ["makeup", "make up", "cushion", "foundation", "bedak", "skin tint", "concealer", "alas bedak", "powder"],
  "Sunscreen": ["sunscreen", "sunblock", "sun screen", "tabir surya", "spf", "sunscren", "sunskrin", "sunsreen"],
  "Perawatan Mata": ["eye cream", "krim mata", "eye serum", "mata panda", "kantung mata"],
  "Eksfoliasi": ["peeling", "eksfoliasi", "exfoliating", "exfoliant", "exfoliasi", "scrub"],
  "Toner & Essence": ["toner", "essence", "mist", "face mist"],
  "Perawatan Jerawat": ["acne patch", "pimple patch", "patch jerawat", "obat totol"],
  "Serum": ["serum", "ampoule", "ampul"],
  "Perawatan Tubuh": ["body", "badan", "body lotion"],
  "Pelembap": ["pelembab", "pelembap", "moisturizer", "moisturiser", "mosturizer", "moisturizing", "moisture", "moist"]
};

const INTENTS = [
  { nama: "termurah", re: /(termurah|paling murah|yg murah|yang murah|\bmurah\b|terjangkau|ramah kantong|low budget|harga miring)/ },
  { nama: "termahal", re: /(termahal|paling mahal|paling premium)/ },
  { nama: "terlaris", re: /(terlaris|paling laris|\blaris\b|best ?seller|paling laku|\blaku\b|paling banyak (di)?beli|paling populer|\bpopuler\b|\bviral\b|favorit|andalan)/ },
  { nama: "rating", re: /(rating (tertinggi|terbaik|paling tinggi|paling bagus|bagus)|bintang (5|lima)|review (terbaik|paling bagus)|ulasan terbaik)/ },
  { nama: "diskon", re: /(diskon|promo|\bsale\b|potongan|lagi murah)/ },
  { nama: "semua", re: /(semua produk|semuanya|katalog|daftar produk|list produk|produk (apa|apa aja|apa saja)|ada (apa aja|apa saja)|jual apa|kategori apa|produknya apa)/ },
  { nama: "rekomendasi", re: /(rekomendasi|rekomen|recommend|saran|cocok|bagus|sebaiknya|enaknya)/ }
];

const GREETINGS = /^(halo+|hallo+|hai+|hi+|hey+|hei+|helo+|hello+|p|ping|test|tes|permisi|pagi|siang|sore|malam|selamat (pagi|siang|sore|malam)|assalamu.?alaikum|assalamualaikum|salam)( (kak|kakak|min|admin|mimin|gan|sis|bang|semua|bot))?[!. ]*$/i;

// ---------------- Utilitas ----------------
function rupiah(n) {
  if (n == null || isNaN(n)) return "-";
  return "Rp" + Math.round(n).toLocaleString("id-ID");
}

function normalizeText(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(s) {
  return normalizeText(s)
    .replace(/[^a-z0-9%+\s-]/g, " ")
    .split(/[\s-]+/)
    .map(t => t.replace(/^\++|\++$/g, ""))
    .filter(t => t.length >= 2);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Semua kata yang muncul di nama produk (untuk koreksi salah ketik)
const VOCAB = new Set();
for (const p of PRODUCTS) for (const t of tokenize(p.nama)) if (t.length >= 4) VOCAB.add(t);

function correctToken(token) {
  if (token.length < 4 || VOCAB.has(token)) return token;
  if (PRODUCTS.some(p => p.nama.toLowerCase().includes(token))) return token;
  const maxDist = token.length >= 7 ? 2 : 1;
  let best = null;
  let bestDist = Infinity;
  for (const word of VOCAB) {
    if (Math.abs(word.length - token.length) > maxDist) continue;
    const d = levenshtein(token, word);
    if (d < bestDist) { bestDist = d; best = word; }
  }
  return bestDist <= maxDist ? best : token;
}

// ---------------- Deteksi di pertanyaan ----------------
function toNumber(numStr, suffix) {
  let s = String(numStr);
  let n;
  if (suffix) {
    n = parseFloat(s.replace(",", "."));
    const sfx = suffix.toLowerCase();
    n *= sfx === "jt" || sfx === "juta" ? 1000000 : 1000;
  } else {
    n = /[.,]\d{3}\b/.test(s) ? Number(s.replace(/[.,]/g, "")) : parseFloat(s.replace(",", "."));
    if (n < 1000) n *= 1000; // "di bawah 100" biasanya maksudnya 100 ribu
  }
  return Math.round(n);
}

function parsePriceLimit(q) {
  const NUM = "(?:rp\\.?\\s*)?(\\d+(?:[.,]\\d+)*)\\s*(rb|ribu|k|jt|juta)?\\b";
  let rest = q;
  let min = null;
  let max = null;

  const range = new RegExp(`(?:antara|dari|range)\\s*${NUM}\\s*(?:-|sampai|hingga|s\\/d|ke|sd)\\s*${NUM}`, "i");
  const mr = rest.match(range);
  if (mr) {
    min = toNumber(mr[1], mr[2]);
    max = toNumber(mr[3], mr[4] || mr[2]);
    rest = rest.replace(mr[0], " ");
  }
  const maxRe = new RegExp(`(?:di ?bawah|kurang dari|maks(?:imal)?|max|budget|under|<|<=|ga lebih dari|gak lebih dari|tidak lebih dari|paling mahal|cuma ada|cuma punya|modal|sampai)\\s*${NUM}`, "i");
  const mx = rest.match(maxRe);
  if (mx) {
    max = toNumber(mx[1], mx[2]);
    rest = rest.replace(mx[0], " ");
  }
  const minRe = new RegExp(`(?:di ?atas|lebih dari|minimal|min\\.?|over|>|>=)\\s*${NUM}`, "i");
  const mn = rest.match(minRe);
  if (mn) {
    min = toNumber(mn[1], mn[2]);
    rest = rest.replace(mn[0], " ");
  }
  return { min, max, rest };
}

function detectIntent(q) {
  for (const it of INTENTS) if (it.re.test(q)) return it.nama;
  return null;
}

const EXISTING_CATEGORIES = new Set(PRODUCTS.map(p => p.kategori));
const CATEGORY_MATCHERS = Object.entries(CATEGORY_ALIASES).map(([nama, list]) => ({
  nama,
  list,
  matchers: list.map(keywordMatcher)
}));

function detectCategories(q) {
  const found = [];
  for (const c of CATEGORY_MATCHERS) {
    if (!EXISTING_CATEGORIES.has(c.nama)) continue;
    if (c.matchers.some(m => m(q))) found.push(c.nama);
  }
  // Nama kategori dari kategori.json yang tidak ada di daftar alias
  for (const k of kategoriConfig.kategori || []) {
    if (!found.includes(k.nama) && EXISTING_CATEGORIES.has(k.nama) && q.includes(k.nama.toLowerCase())) {
      found.push(k.nama);
    }
  }
  return found;
}

function detectConcerns(q) {
  return CONCERNS.filter(c => c.pemicu.some(p => keywordMatcher(p)(q)));
}

function isGreeting(q) {
  return GREETINGS.test(normalizeText(q));
}

// Kata-kata yang sudah "terpakai" sebagai kategori, masalah kulit, atau maksud
function consumedWords(categories, concerns) {
  const words = new Set();
  // Kalau yang disebut cuma satu kategori, kata kategorinya tidak dipakai lagi untuk skor.
  // Kalau dua atau lebih ("serum sunscreen"), katanya tetap dipakai supaya produk yang
  // namanya mengandung keduanya naik ke atas.
  if (categories.length === 1) {
    for (const c of CATEGORY_MATCHERS) if (categories.includes(c.nama)) c.list.forEach(w => tokenize(w).forEach(t => words.add(t)));
  }
  for (const c of concerns) c.pemicu.forEach(w => tokenize(w).forEach(t => words.add(t)));
  `termurah murah termahal mahal terlaris laris laku seller bestseller populer viral favorit andalan rating
   bintang review ulasan diskon promo sale potongan semua semuanya katalog daftar list kategori premium
   terjangkau budget kantong miring tertinggi tinggi terbesar besar gede terbaru lima banyak beli dibeli`.split(/\s+/).forEach(w => words.add(w));
  return words;
}

// ---------------- Pencarian ----------------
// opts.override dipakai untuk pertanyaan lanjutan: maksud/harga dari pesan terbaru
// menimpa maksud/harga dari pesan sebelumnya.
function search(query, opts = {}) {
  let k = opts.k || TOP_K;
  const override = opts.override || {};
  const q0 = normalizeText(query);
  const info = {
    kategori: [], masalahKulit: [], kataKunci: [], kataTidakKetemu: [], maksud: null,
    hargaMin: null, hargaMaks: null, adaSinyal: false, dilonggarkan: false
  };
  if (!q0 || PRODUCTS.length === 0 || isGreeting(q0)) return { produk: [], info };

  const parsed = parsePriceLimit(q0);
  const min = override.hargaMin != null ? override.hargaMin : parsed.min;
  const max = override.hargaMaks != null ? override.hargaMaks : parsed.max;
  const q = normalizeText(parsed.rest);
  info.hargaMin = min;
  info.hargaMaks = max;
  info.maksud = override.maksud || detectIntent(q);
  info.kategori = detectCategories(q);
  const concerns = detectConcerns(q);
  info.masalahKulit = concerns.map(c => c.nama);

  const consumed = consumedWords(info.kategori, concerns);
  const rawTokens = tokenize(q).filter(t => !STOPWORDS.has(t) && !consumed.has(t));
  for (const t of rawTokens) {
    const fixed = correctToken(t);
    const ketemu = PRODUCTS.some(p => p.nama.toLowerCase().includes(fixed));
    if (ketemu) info.kataKunci.push(fixed);
    else info.kataTidakKetemu.push(t);
  }
  info.kataKunci = [...new Set(info.kataKunci)];

  const adaTeks = info.kataKunci.length > 0 || concerns.length > 0;
  info.adaSinyal = Boolean(
    info.kategori.length || adaTeks || info.maksud || min != null || max != null
  );
  if (!info.adaSinyal) return { produk: [], info };

  // 1) Saring kategori & harga
  let kandidat = PRODUCTS;
  if (info.kategori.length) {
    const byCat = kandidat.filter(p => info.kategori.includes(p.kategori));
    if (byCat.length) kandidat = byCat;
  }
  if (min != null) kandidat = kandidat.filter(p => p.harga >= min);
  if (max != null) kandidat = kandidat.filter(p => p.harga <= max);
  if (info.maksud === "diskon") {
    const adaDiskon = kandidat.filter(p => p.diskon > 0);
    if (adaDiskon.length) kandidat = adaDiskon;
  }

  // 2) Beri skor
  let scored = kandidat.map(p => {
    const nama = p.nama.toLowerCase();
    let skor = 0;
    for (const t of info.kataKunci) {
      if (nama.includes(t)) skor += 6;
      if (keywordMatcher(t)(nama)) skor += 2;
    }
    for (const c of concerns) {
      const cocok = c.cari.filter(term => nama.includes(term)).length;
      skor += Math.min(cocok, 3) * 3;
    }
    if (info.kategori.includes(p.kategori)) skor += 2;
    return { p, skor };
  });

  if (adaTeks) {
    const ambang = info.kategori.length ? 2 : 0;
    const cocok = scored.filter(s => s.skor > ambang);
    if (cocok.length) scored = cocok;
    else if (info.kategori.length) info.dilonggarkan = true; // tetap tampilkan isi kategorinya
    else scored = [];
  }

  // 3) Urutkan sesuai maksud
  const bySold = (a, b) => (b.p.terjual || 0) - (a.p.terjual || 0);
  const sorters = {
    termurah: (a, b) => a.p.harga - b.p.harga,
    termahal: (a, b) => b.p.harga - a.p.harga,
    terlaris: bySold,
    rating: (a, b) => (b.p.rating || 0) - (a.p.rating || 0) || bySold(a, b),
    diskon: (a, b) => (b.p.diskon || 0) - (a.p.diskon || 0) || bySold(a, b)
  };
  const sorter = sorters[info.maksud] || ((a, b) => b.skor - a.skor || bySold(a, b));
  scored.sort(sorter);

  // "semua produk" tanpa kategori: ambil 1-2 produk terlaris dari tiap kategori
  if (info.maksud === "semua" && !info.kategori.length && !adaTeks) {
    const perKat = {};
    const hasil = [];
    for (const s of scored.slice().sort(bySold)) {
      perKat[s.p.kategori] = (perKat[s.p.kategori] || 0) + 1;
      if (perKat[s.p.kategori] <= 2) hasil.push(s);
    }
    scored = hasil;
    k = Math.max(k, 12);
  }

  return { produk: scored.slice(0, k).map(s => s.p), info };
}

// ---------------- Konteks untuk LLM ----------------
function categorySummary() {
  const map = {};
  for (const p of PRODUCTS) {
    if (!map[p.kategori]) map[p.kategori] = { n: 0, min: Infinity, max: 0 };
    const m = map[p.kategori];
    m.n++;
    m.min = Math.min(m.min, p.harga);
    m.max = Math.max(m.max, p.harga);
  }
  return Object.entries(map)
    .sort((a, b) => b[1].n - a[1].n)
    .map(([nama, m]) => `- ${nama}: ${m.n} produk (${rupiah(m.min)} - ${rupiah(m.max)})`)
    .join("\n");
}

function formatProductLine(p, i) {
  const harga = p.harga_asli
    ? `${rupiah(p.harga)} (harga normal ${rupiah(p.harga_asli)}${p.diskon ? `, diskon ${p.diskon}%` : ""})`
    : `${rupiah(p.harga)}${p.diskon ? ` (diskon ${p.diskon}%)` : ""}`;
  const bagian = [
    `Kategori: ${p.kategori}`,
    `Harga: ${harga}`,
    p.rating ? `Rating: ${p.rating}` : null,
    p.terjual_teks ? `Terjual: ${p.terjual_teks}` : null,
    p.link ? `Link: ${p.link}` : null
  ].filter(Boolean);
  return `${i + 1}. ${p.nama}\n   ${bagian.join(" | ")}`;
}

function buildContext(result) {
  const { produk, info } = result;
  const filter = [];
  if (info.kategori.length) filter.push(`kategori ${info.kategori.join(", ")}`);
  if (info.masalahKulit.length) filter.push(`masalah kulit ${info.masalahKulit.join(", ")}`);
  if (info.hargaMin != null) filter.push(`harga minimal ${rupiah(info.hargaMin)}`);
  if (info.hargaMaks != null) filter.push(`harga maksimal ${rupiah(info.hargaMaks)}`);
  if (info.maksud && info.maksud !== "rekomendasi") filter.push(`urutan/maksud: ${info.maksud}`);

  let out = `DATA PRODUK LAPAK (hasil scraping Shopee, total ${PRODUCTS.length} produk)\n`;
  if (filter.length) out += `Pencarian: ${filter.join("; ")}\n`;
  if (info.dilonggarkan) {
    out += `Catatan: tidak ada nama produk di kategori itu yang menyebut kata kunci/masalah kulit yang ditanyakan, jadi ini isi kategorinya secara umum.\n`;
  }
  if (info.kataTidakKetemu.length) {
    out += `Kata yang tidak ditemukan di nama produk mana pun: ${info.kataTidakKetemu.join(", ")}\n`;
  }
  if (produk.length) {
    out += `\nProduk yang relevan (${produk.length}):\n` + produk.map(formatProductLine).join("\n");
  } else {
    out += `\nTidak ada produk yang cocok dengan pertanyaan ini.`;
  }
  out += `\n\nRINGKASAN KATEGORI DI LAPAK:\n${categorySummary()}`;
  return out;
}

function getProducts() {
  return PRODUCTS;
}

module.exports = {
  search,
  buildContext,
  getProducts,
  categorySummary,
  isGreeting,
  rupiah,
  parsePriceLimit,
  detectCategories,
  detectIntent
};
