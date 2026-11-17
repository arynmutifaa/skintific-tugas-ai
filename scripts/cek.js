// npm run cek
// Memeriksa hasil scraping (data/products.csv) TANPA menyimpan apa-apa.
// Pakai ini untuk melihat: berapa produk terbaca, kolom mana terbaca sebagai apa,
// dan apakah ada produk yang salah kategori.

const fs = require("fs");
const path = require("path");
const { normalizeFile, loadKategoriConfig } = require("../lib/normalize");

const DATA_DIR = path.join(__dirname, "..", "data");
const CSV_PATH = path.join(DATA_DIR, "products.csv");

if (!fs.existsSync(CSV_PATH)) {
  console.error("\n[!] File data/products.csv belum ada.");
  console.error("    Hasil download Instant Data Scraper (shopee.csv) ganti namanya jadi products.csv,");
  console.error("    lalu taruh di folder data/ di dalam proyek ini.\n");
  process.exit(1);
}

const kategori = loadKategoriConfig(DATA_DIR);
const { produk, report } = normalizeFile(CSV_PATH, kategori);
const rp = n => (n == null ? "-" : "Rp" + n.toLocaleString("id-ID"));

console.log("\n=== CEK HASIL SCRAPING: data/products.csv ===\n");
console.log(`Pemisah kolom          : ${report.pemisah}`);
console.log(`Baris data mentah      : ${report.barisMentah}`);
console.log(`Produk valid           : ${report.produkValid}`);
console.log(`Duplikat dibuang       : ${report.duplikatDibuang}`);
console.log(`Dibuang (tanpa nama)   : ${report.dibuangTanpaNama}`);
console.log(`Dibuang (tanpa harga)  : ${report.dibuangTanpaHarga}`);
console.log(`Tanpa link produk      : ${report.tanpaLink}`);
console.log(`Tanpa gambar           : ${report.tanpaGambar}`);

console.log("\nKolom CSV terbaca sebagai:");
console.table(report.kolom);

const perKategori = {};
for (const p of produk) perKategori[p.kategori] = (perKategori[p.kategori] || 0) + 1;
console.log("Jumlah produk per kategori:");
console.table(Object.entries(perKategori).sort((a, b) => b[1] - a[1]).map(([kategori, jumlah]) => ({ kategori, jumlah })));

console.log("Contoh produk (15 pertama):");
console.table(produk.slice(0, 15).map(p => ({
  nama: p.nama.length > 48 ? p.nama.slice(0, 47) + "…" : p.nama,
  kategori: p.kategori,
  harga: rp(p.harga),
  rating: p.rating ?? "-",
  terjual: p.terjual_teks || "-",
  link: p.link ? "ada" : "TIDAK ADA"
})));

const lainnya = produk.filter(p => p.kategori === "Lainnya");
if (lainnya.length) {
  console.log(`[!] ${lainnya.length} produk masuk kategori "Lainnya". Tambahkan kata kuncinya di data/kategori.json:`);
  lainnya.forEach(p => console.log("    - " + p.nama));
  console.log("");
}
if (report.tanpaLink > 0) {
  console.log("[!] Ada produk tanpa link. Pastikan kolom \"contents href\" ikut ter-download di Instant Data Scraper.\n");
}
if (produk.length < 20) {
  console.log("[!] Produknya masih sedikit. Scroll halaman toko sampai bawah sebelum scraping, atau aktifkan tombol Next.\n");
}

const knowledge = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "knowledge.json"), "utf-8"));
if (/x/i.test(knowledge.toko.whatsapp || "x")) {
  console.log("[!] Nomor WhatsApp di data/knowledge.json masih contoh (62xxxxxxxxxx). Ganti dengan nomor bot kamu.\n");
}

console.log("Kalau sudah oke, simpan datanya dengan: npm run build-data\n");
