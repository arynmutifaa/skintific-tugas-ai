// Server untuk menjalankan website di laptop: npm run dev -> http://localhost:3000
// Di Vercel file ini TIDAK dipakai. Vercel langsung menayangkan folder public/
// dan menjalankan api/chat.js sebagai serverless function.

require("dotenv").config({ quiet: true });
const express = require("express");
const path = require("path");
const chatHandler = require("./api/chat");
const { status } = require("./lib/chat");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.all("/api/chat", (req, res) => chatHandler(req, res));

const server = app.listen(PORT, () => {
  const s = status();
  console.log("");
  console.log(`  Website  : http://localhost:${PORT}`);
  console.log(`  Lapak    : ${s.toko}`);
  console.log(`  Data     : ${s.jumlahProduk} produk, ${s.jumlahKategori} kategori`);
  console.log(`  Groq     : ${s.groqTerpasang ? `terpasang (model ${s.model})` : "API key belum diisi di .env, bot pakai jawaban cadangan"}`);
  console.log("");
  console.log("  Tekan Ctrl + C untuk berhenti.");
  if (!s.jumlahProduk) console.log("\n  [!] Data produk kosong. Jalankan dulu: npm run build-data");
});

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n[!] Port ${PORT} sudah dipakai program lain (mungkin npm run dev yang lama masih jalan).`);
    console.error("    Tutup terminal lama / tekan Ctrl + C di sana, atau ganti PORT di file .env.\n");
  } else {
    console.error(err);
  }
  process.exit(1);
});
