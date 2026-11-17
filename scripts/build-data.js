// npm run build-data
// Mengubah data/products.csv (hasil scraping) menjadi:
//   - data/products.json  -> dibaca mesin RAG (chatbot website & WhatsApp)
//   - public/data.json    -> dibaca tampilan website katalog
// Jalankan ulang setiap kali products.csv, kategori.json, atau knowledge.json diubah.

const fs = require("fs");
const path = require("path");
const { normalizeFile, loadKategoriConfig } = require("../lib/normalize");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const CSV_PATH = path.join(DATA_DIR, "products.csv");

if (!fs.existsSync(CSV_PATH)) {
  console.error("\n[!] File data/products.csv belum ada. Taruh hasil scraping di sana dulu.\n");
  process.exit(1);
}

const kategoriConfig = loadKategoriConfig(DATA_DIR);
const knowledge = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "knowledge.json"), "utf-8"));
const { produk, report } = normalizeFile(CSV_PATH, kategoriConfig);

if (!produk.length) {
  console.error("\n[!] Tidak ada produk yang terbaca. Jalankan npm run cek untuk melihat masalahnya.\n");
  process.exit(1);
}

// Urutan kategori mengikuti kategori.json, yang kosong tidak ditampilkan
const urutan = (kategoriConfig.kategori || []).map(k => k.nama).concat(["Lainnya"]);
const kategori = urutan
  .map(nama => ({ nama, jumlah: produk.filter(p => p.kategori === nama).length }))
  .filter(k => k.jumlah > 0)
  .sort((a, b) => b.jumlah - a.jumlah);

const meta = {
  sumber: "Instant Data Scraper (data/products.csv)",
  dibuat: new Date().toISOString(),
  jumlah_produk: produk.length,
  jumlah_kategori: kategori.length
};

fs.writeFileSync(
  path.join(DATA_DIR, "products.json"),
  JSON.stringify({ meta, kategori, produk }, null, 2)
);

const { _catatan, ...templateWa } = knowledge.template_wa || {};
const { _catatan: _c, ...toko } = knowledge.toko || {};
fs.writeFileSync(
  path.join(ROOT, "public", "data.json"),
  JSON.stringify({ meta, toko, template_wa: templateWa, kategori, produk })
);

const hargaMin = Math.min(...produk.map(p => p.harga));
console.log(`\n[OK] ${produk.length} produk, ${kategori.length} kategori (harga mulai Rp${hargaMin.toLocaleString("id-ID")})`);
console.log("     -> data/products.json (untuk chatbot)");
console.log("     -> public/data.json   (untuk website)");
if (report.duplikatDibuang) console.log(`     ${report.duplikatDibuang} baris duplikat dibuang`);
if (/x/i.test(toko.whatsapp || "x")) {
  console.log("\n[!] Nomor WhatsApp di data/knowledge.json masih contoh. Ganti dulu, lalu jalankan npm run build-data lagi.");
}
console.log("");
