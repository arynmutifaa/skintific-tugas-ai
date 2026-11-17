// Merapikan CSV hasil Instant Data Scraper menjadi daftar produk yang rapi.
//
// Masalahnya: nama kolom dari Instant Data Scraper diambil dari nama class CSS
// Shopee (misalnya "line-clamp-2", "truncate", "w-full src"), jadi tidak bisa
// dipakai untuk tahu kolom mana yang berisi harga atau nama. Urutan kolom juga
// kadang bergeser antar baris (misalnya kolom promo dan kolom terjual tertukar).
//
// Solusinya: file ini membaca ISI setiap sel, bukan nama kolomnya.
//   - sel berisi link shopee.co.id/...-i.angka.angka  -> link produk
//   - sel berisi link gambar (susercontent.com)        -> foto produk
//   - sel berisi "terjual" / "sold"                    -> jumlah terjual
//   - sel berisi angka 1-5 dengan desimal (4.9)        -> rating
//   - sel berisi "-40%"                                -> diskon
//   - sel berisi angka harga (89.000 / Rp89.000)       -> harga
//   - teks terpanjang                                  -> nama produk
// Kalau CSV-nya sudah rapi (ada kolom nama, harga, link), kolom itu dipakai langsung.

const fs = require("fs");
const path = require("path");
const { parseCSV, detectDelimiter } = require("./csv");

const clean = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

const RE_URL = /^https?:\/\//i;
const RE_PRODUCT_LINK = /shopee\.co\.id\/(?:.+-i\.\d+\.\d+|product\/\d+\/\d+)/i;
const RE_REL_PRODUCT_LINK = /^\/.+-i\.\d+\.\d+/;
const RE_IMAGE = /(susercontent\.com|img\.shopee|cf\.shopee|\.(?:jpe?g|png|webp|gif)(?:[?#]|$))/i;
const RE_SOLD = /(terjual|sold)/i;
const RE_RATING = /^(?:[1-4][.,]\d{1,2}|5(?:[.,]0{1,2})?)$/;
const RE_DISCOUNT = /^-?\s?\d{1,2}\s?%(\s?off)?$/i;
const RE_PRICE_SINGLE = /^(?:rp\.?\s?)?\d{1,3}(?:[.,]\d{3})+$|^rp\.?\s?\d{3,}$/i;
const RE_PRICE_RANGE = /^(?:rp\.?\s?)?[\d.,]+\s?[-–~]\s?(?:rp\.?\s?)?[\d.,]+$/i;
const RE_LOCATION = /^(kota|kab\.?|kabupaten|luar negeri|jakarta|bandung|surabaya|tangerang|bekasi)\b/i;

// Nama kolom yang dikenali kalau CSV-nya sudah dirapikan manual
const HEADER_ALIASES = {
  nama: /^(nama|name|nama produk|product name|produk|judul|title)$/i,
  harga: /^(harga|price|harga jual|harga diskon)$/i,
  harga_asli: /^(harga asli|harga normal|harga coret|original price)$/i,
  link: /^(link|url|href|link produk|product link|product url)$/i,
  gambar: /^(gambar|image|img|foto|image url|link gambar)$/i,
  kategori: /^(kategori|category)$/i,
  deskripsi: /^(deskripsi|description|keterangan)$/i,
  terjual: /^(terjual|sold|jumlah terjual)$/i,
  rating: /^(rating|bintang|nilai)$/i,
  diskon: /^(diskon|discount)$/i,
  lokasi: /^(lokasi|location|kota)$/i
};

function parsePrice(value) {
  const v = clean(value).toLowerCase();
  if (!v) return null;
  let first = v;
  if (RE_PRICE_RANGE.test(v)) first = v.split(/[-–~]/)[0];
  const digits = first.replace(/rp\.?/g, "").replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isFinite(n) || n < 500 || n > 50000000) return null;
  return n;
}

function looksLikePrice(value) {
  const v = clean(value);
  return RE_PRICE_SINGLE.test(v) || RE_PRICE_RANGE.test(v);
}

// "10RB+ terjual" -> 10000, "1,2RB terjual" -> 1200, "999 terjual" -> 999
function parseSold(value) {
  const v = clean(value).toLowerCase();
  const m = v.match(/([\d.,]+)\s*(rb|ribu|k|jt|juta|m)?\s*(\+)?/i);
  if (!m) return { angka: 0, teks: clean(value) };
  const numStr = m[1];
  const suffix = (m[2] || "").toLowerCase();
  let angka;
  if (suffix) {
    const base = parseFloat(numStr.replace(",", "."));
    const mult = suffix === "rb" || suffix === "ribu" || suffix === "k" ? 1000 : 1000000;
    angka = Math.round(base * mult);
  } else {
    angka = parseInt(numStr.replace(/[.,]/g, ""), 10);
  }
  const teks = clean(value)
    .replace(/\s*(terjual|sold)\s*/i, "")
    .trim();
  return { angka: Number.isFinite(angka) ? angka : 0, teks: teks || clean(value) };
}

function cleanLink(value) {
  let v = clean(value);
  if (RE_REL_PRODUCT_LINK.test(v)) v = "https://shopee.co.id" + v;
  return v.split("?")[0].split("#")[0];
}

function productIdFromLink(link) {
  const m = String(link).match(/-i\.(\d+)\.(\d+)/) || String(link).match(/product\/(\d+)\/(\d+)/);
  return m ? `${m[1]}.${m[2]}` : null;
}

// ---------------- Kategori ----------------
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Kata kunci biasa dicocokkan sebagai kata utuh ("set" tidak cocok dengan "setting").
// Kata kunci berakhiran * dicocokkan sebagai awalan ("moistur*" cocok dengan moisturizer dan moisture).
// Kata kunci tanpa huruf/angka (misalnya " + ") dicocokkan apa adanya.
function keywordMatcher(keyword) {
  const kw = String(keyword).toLowerCase();
  if (!/[a-z0-9]/.test(kw)) return text => text.includes(kw);
  const isPrefix = kw.endsWith("*");
  const core = escapeRegex(kw.replace(/\*$/, "").trim()).replace(/\s+/g, "\\s+");
  const re = new RegExp(`(^|[^a-z0-9])${core}${isPrefix ? "" : "(?![a-z0-9])"}`, "i");
  return text => re.test(text);
}

function buildCategoryRules(kategoriConfig) {
  const list = (kategoriConfig && kategoriConfig.kategori) || [];
  return list.map(k => ({
    nama: k.nama,
    matchers: (k.kata_kunci || []).map(keywordMatcher)
  }));
}

function categorize(nama, rules, fallback = "Lainnya") {
  const text = String(nama || "").toLowerCase();
  for (const rule of rules) {
    if (rule.matchers.some(match => match(text))) return rule.nama;
  }
  return fallback;
}

// ---------------- Header & kolom ----------------
function mapHeader(headerRow) {
  const map = {};
  headerRow.forEach((h, idx) => {
    const name = clean(h);
    for (const [field, re] of Object.entries(HEADER_ALIASES)) {
      if (re.test(name)) {
        map[idx] = field;
        break;
      }
    }
  });
  return map;
}

function rowHasProductLink(row) {
  return row.some(c => RE_PRODUCT_LINK.test(clean(c)) || RE_REL_PRODUCT_LINK.test(clean(c)));
}

// ---------------- Membaca satu baris ----------------
function analyzeRow(cells, headerMap, columnStats) {
  const out = {
    nama: "",
    hargaList: [],
    hargaAsliHeader: null,
    link: "",
    gambar: [],
    terjual: null,
    rating: null,
    diskon: null,
    lokasi: "",
    kategoriCsv: "",
    deskripsi: "",
    texts: []
  };

  const note = (idx, type) => {
    if (!columnStats[idx]) columnStats[idx] = {};
    columnStats[idx][type] = (columnStats[idx][type] || 0) + 1;
  };

  cells.forEach((raw, idx) => {
    const v = clean(raw);
    if (!v) return;

    // 1) Kolom yang namanya sudah jelas (CSV rapi)
    const field = headerMap[idx];
    if (field === "nama") { out.nama = v; note(idx, "nama"); return; }
    if (field === "kategori") { out.kategoriCsv = v; note(idx, "kategori"); return; }
    if (field === "deskripsi") { out.deskripsi = v; note(idx, "deskripsi"); return; }
    if (field === "harga" && parsePrice(v)) { out.hargaList.push(parsePrice(v)); note(idx, "harga"); return; }
    if (field === "harga_asli" && parsePrice(v)) { out.hargaAsliHeader = parsePrice(v); note(idx, "harga_asli"); return; }
    if (field === "lokasi") { out.lokasi = v; note(idx, "lokasi"); return; }

    // 2) Tebak dari isi sel
    if (RE_URL.test(v) || RE_REL_PRODUCT_LINK.test(v)) {
      if (RE_PRODUCT_LINK.test(v) || RE_REL_PRODUCT_LINK.test(v)) {
        if (!out.link) out.link = cleanLink(v);
        note(idx, "link");
      } else if (RE_IMAGE.test(v)) {
        out.gambar.push({ idx, url: v });
        note(idx, "gambar");
      }
      return;
    }
    if (RE_SOLD.test(v)) {
      out.terjual = parseSold(v);
      note(idx, "terjual");
      return;
    }
    if (RE_DISCOUNT.test(v)) {
      out.diskon = Number(v.replace(/[^\d]/g, ""));
      note(idx, "diskon");
      return;
    }
    if (RE_RATING.test(v)) {
      out.rating = Number(v.replace(",", "."));
      note(idx, "rating");
      return;
    }
    if (looksLikePrice(v)) {
      const p = parsePrice(v);
      if (p) {
        out.hargaList.push(p);
        note(idx, "harga");
        return;
      }
    }
    if (RE_LOCATION.test(v) && v.length <= 40) {
      out.lokasi = v;
      note(idx, "lokasi");
      return;
    }
    if (/^rp\.?$/i.test(v)) return; // sel yang isinya cuma "Rp"
    out.texts.push({ idx, v });
  });

  return out;
}

// ---------------- Fungsi utama ----------------
function normalizeRows(rows, kategoriConfig) {
  const report = {
    barisMentah: 0,
    produkValid: 0,
    duplikatDibuang: 0,
    dibuangTanpaNama: 0,
    dibuangTanpaHarga: 0,
    tanpaLink: 0,
    tanpaGambar: 0,
    header: [],
    kolom: []
  };
  if (!rows || rows.length === 0) return { produk: [], report };

  let headerRow = [];
  let dataRows = rows;
  if (!rowHasProductLink(rows[0])) {
    headerRow = rows[0];
    dataRows = rows.slice(1);
  }
  report.header = headerRow.map(clean);
  report.barisMentah = dataRows.length;

  const headerMap = mapHeader(headerRow);
  const rules = buildCategoryRules(kategoriConfig);
  const columnStats = {};

  const analyzed = dataRows.map(cells => analyzeRow(cells, headerMap, columnStats));

  // Pilih kolom gambar yang isinya paling beragam.
  // Bingkai promo/label Shopee juga berupa gambar, tapi isinya sama di semua produk.
  const imageValues = {};
  analyzed.forEach(r => r.gambar.forEach(g => {
    if (!imageValues[g.idx]) imageValues[g.idx] = [];
    imageValues[g.idx].push(g.url);
  }));
  const imageScore = {};
  for (const [idx, list] of Object.entries(imageValues)) {
    imageScore[idx] = new Set(list).size / list.length + list.length / Math.max(1, analyzed.length) * 0.01;
  }

  const produk = [];
  const seen = new Set();

  analyzed.forEach((r, i) => {
    // Nama = teks terpanjang yang mengandung huruf
    let nama = r.nama;
    const others = [];
    if (!nama) {
      const candidates = r.texts
        .filter(t => /[a-z]/i.test(t.v) && t.v.length >= 8)
        .sort((a, b) => b.v.length - a.v.length);
      if (candidates.length) {
        nama = candidates[0].v;
        const idx = candidates[0].idx;
        if (!columnStats[idx]) columnStats[idx] = {};
        columnStats[idx].nama = (columnStats[idx].nama || 0) + 1;
      }
    }
    r.texts.forEach(t => {
      if (t.v !== nama && t.v.length <= 30) others.push(t.v);
    });

    if (!nama) { report.dibuangTanpaNama++; return; }
    if (r.hargaList.length === 0) { report.dibuangTanpaHarga++; return; }

    const harga = Math.min(...r.hargaList);
    let hargaAsli = r.hargaAsliHeader || Math.max(...r.hargaList);
    if (hargaAsli <= harga) hargaAsli = null;
    let diskon = r.diskon;
    if (!diskon && hargaAsli) diskon = Math.round((1 - harga / hargaAsli) * 100);

    let gambar = "";
    if (r.gambar.length) {
      gambar = r.gambar
        .slice()
        .sort((a, b) => (imageScore[b.idx] || 0) - (imageScore[a.idx] || 0))[0].url;
    }

    const id = productIdFromLink(r.link) || `p${i + 1}`;
    const key = r.link ? `link:${r.link}` : `nama:${nama.toLowerCase()}`;
    if (seen.has(key)) { report.duplikatDibuang++; return; }
    seen.add(key);

    if (!r.link) report.tanpaLink++;
    if (!gambar) report.tanpaGambar++;

    produk.push({
      id,
      nama,
      kategori: r.kategoriCsv || categorize(nama, rules),
      harga,
      harga_asli: hargaAsli,
      diskon: diskon || null,
      rating: r.rating,
      terjual: r.terjual ? r.terjual.angka : 0,
      terjual_teks: r.terjual ? r.terjual.teks : "",
      link: r.link,
      gambar,
      lokasi: r.lokasi,
      deskripsi: r.deskripsi,
      label: [...new Set(others)].slice(0, 4)
    });
  });

  report.produkValid = produk.length;

  // Ringkasan kolom: kolom ke berapa terbaca sebagai apa
  const labelTipe = {
    nama: "nama produk", link: "link produk", gambar: "gambar", harga: "harga",
    harga_asli: "harga asli", terjual: "jumlah terjual", rating: "rating",
    diskon: "diskon", lokasi: "lokasi", kategori: "kategori", deskripsi: "deskripsi"
  };
  const totalCols = Math.max(headerRow.length, ...dataRows.map(r => r.length));
  for (let idx = 0; idx < totalCols; idx++) {
    const stats = columnStats[idx] || {};
    const entries = Object.entries(stats).sort((a, b) => b[1] - a[1]);
    report.kolom.push({
      kolom: clean(headerRow[idx]) || `(kolom ${idx + 1})`,
      terbaca_sebagai: entries.length ? entries.map(([t, n]) => `${labelTipe[t] || t} (${n})`).join(", ") : "teks lain / label"
    });
  }

  return { produk, report };
}

function loadKategoriConfig(dataDir) {
  const p = path.join(dataDir, "kategori.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function normalizeFile(csvPath, kategoriConfig) {
  const text = fs.readFileSync(csvPath, "utf-8");
  const rows = parseCSV(text);
  const result = normalizeRows(rows, kategoriConfig);
  result.report.pemisah = { ",": "koma", ";": "titik koma", "\t": "tab" }[detectDelimiter(text)];
  return result;
}

module.exports = {
  normalizeRows,
  normalizeFile,
  loadKategoriConfig,
  buildCategoryRules,
  categorize,
  keywordMatcher,
  parsePrice,
  parseSold
};
