# Katalog SKINTIFIC + Chatbot RAG (Website & WhatsApp)

Tugas Praktikum Kecerdasan Artifisial dan Penerapannya — Modul AI Chatbot LLM RAG via WA.

Website katalog lapak SKINTIFIC di Shopee dengan chatbot berbasis RAG (Retrieval-Augmented Generation)
yang jawabannya diambil dari data hasil scraping. Chatbot yang sama juga bisa dichat lewat WhatsApp.

## Cara menjalankan (ringkas)

```bash
npm install                 # pasang library
copy .env.example .env      # Windows (Mac/Linux: cp .env.example .env), lalu isi GROQ_API_KEY
npm run cek                 # cek hasil scraping di data/products.csv
npm run build-data          # simpan data untuk chatbot & website
npm run dev                 # website di http://localhost:3000
npm run wa                  # gateway WhatsApp (scan QR dari HP)
```

## Struktur

| Path | Fungsi |
| --- | --- |
| `data/products.csv` | Hasil scraping Instant Data Scraper (nama kolom boleh acak) |
| `data/kategori.json` | Kata kunci pengelompokan kategori |
| `data/knowledge.json` | Info toko, FAQ, nomor WA, template pesan WA per kategori |
| `lib/csv.js` | Parser CSV (aman untuk nama produk yang mengandung koma) |
| `lib/normalize.js` | Membaca CSV berdasarkan isi sel: link, gambar, harga, terjual, rating, nama |
| `lib/rag.js` | Retrieval: deteksi kategori, masalah kulit, maksud (termurah/terlaris/...), batas harga, skor kata kunci |
| `lib/chat.js` | Pipeline jawaban: template → FAQ → RAG + Groq → jawaban cadangan |
| `api/chat.js` | Serverless function Vercel (`POST /api/chat`, `GET /api/chat` untuk cek status) |
| `gateway/wa.js` | Bot WhatsApp (whatsapp-web.js), memakai `lib/chat.js` yang sama |
| `public/` | Tampilan website |
| `dev-server.js` | Server lokal untuk `npm run dev` (tidak dipakai di Vercel) |

## Deploy ke Vercel

1. Push ke GitHub (pastikan `.env`, `node_modules`, `.wwebjs_auth` tidak ikut — sudah di `.gitignore`).
2. Vercel → Add New → Project → Import repository.
3. Framework Preset: **Other** (sudah diset di `vercel.json`).
4. Environment Variables: `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_MAX_TOKENS`.
5. Deploy.

Catatan: gateway WhatsApp tidak bisa jalan di Vercel karena butuh proses yang menyala terus.
Gateway dijalankan di laptop dengan `npm run wa` dan hanya aktif selama terminalnya terbuka.
