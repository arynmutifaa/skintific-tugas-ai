// Gateway WhatsApp: npm run wa
// Membuka WhatsApp Web di browser tersembunyi (Chromium) lewat whatsapp-web.js,
// lalu setiap pesan masuk dijawab memakai lib/chat.js — logika dan data yang sama
// dengan chatbot di website.
//
// Pertama kali jalan: QR muncul di terminal -> scan dari HP
// (WhatsApp > Perangkat tertaut > Tautkan perangkat).
// Sesi tersimpan di folder .wwebjs_auth, jadi berikutnya tidak perlu scan lagi.

require("dotenv").config({ quiet: true });
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { reply, status } = require("../lib/chat");

const MAX_HISTORY = 8;               // 4 pertanyaan + 4 jawaban terakhir
const SESSION_TTL = 20 * 60 * 1000;  // riwayat dihapus setelah 20 menit tidak aktif
const MAX_START_ATTEMPTS = 3;

const sessions = new Map();

function getHistory(id) {
  const s = sessions.get(id);
  if (!s) return [];
  if (Date.now() - s.last > SESSION_TTL) {
    sessions.delete(id);
    return [];
  }
  return s.messages;
}

function saveHistory(id, userMsg, botMsg) {
  const s = sessions.get(id) && Date.now() - sessions.get(id).last <= SESSION_TTL
    ? sessions.get(id)
    : { messages: [], last: Date.now() };
  s.messages.push({ role: "user", content: userMsg }, { role: "assistant", content: botMsg });
  s.messages = s.messages.slice(-MAX_HISTORY);
  s.last = Date.now();
  sessions.set(id, s);
}

function mask(id) {
  const num = String(id).split("@")[0];
  return num.length > 6 ? `${num.slice(0, 4)}xxxx${num.slice(-3)}` : num;
}

function time() {
  return new Date().toLocaleTimeString("id-ID", { hour12: false });
}

function createClient() {
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: "katalog-skintific" }),
    puppeteer: {
      headless: true,
      protocolTimeout: 300000, // 5 menit, supaya tidak "Page.navigate timed out" di internet lambat
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote"
      ]
    }
  });

  client.on("qr", qr => {
    console.log(`\n[${time()}] [WA] Scan QR ini dari HP: WhatsApp > Perangkat tertaut > Tautkan perangkat\n`);
    qrcode.generate(qr, { small: true });
  });

  client.on("authenticated", () => console.log(`[${time()}] [WA] Terautentikasi`));
  client.on("auth_failure", msg => {
    console.error(`[${time()}] [WA] Autentikasi gagal: ${msg}`);
    console.error("     Hapus folder .wwebjs_auth lalu jalankan npm run wa lagi untuk scan ulang.");
  });
  client.on("loading_screen", percent => {
    if (Number(percent) % 25 === 0) console.log(`[${time()}] [WA] Memuat WhatsApp Web... ${percent}%`);
  });

  client.on("ready", () => {
    const s = status();
    console.log(`\n[${time()}] [WA] Bot siap digunakan untuk lapak "${s.toko}"`);
    console.log(`     Data: ${s.jumlahProduk} produk, ${s.jumlahKategori} kategori | Groq: ${s.groqTerpasang ? s.model : "belum diisi (jawaban cadangan)"}`);
    console.log("     Biarkan terminal ini tetap terbuka. Tekan Ctrl + C untuk berhenti.\n");
  });

  client.on("disconnected", reason => {
    console.log(`[${time()}] [WA] Terputus: ${reason}`);
  });

  client.on("message", async msg => {
    try {
      const from = msg.from || "";
      // Abaikan pesan dari nomor bot sendiri, status, grup, saluran, dan broadcast
      if (msg.fromMe) return;
      if (from === "status@broadcast" || from.endsWith("@g.us") || from.endsWith("@newsletter") || from.endsWith("@broadcast")) return;
      if (!from.endsWith("@c.us") && !from.endsWith("@lid")) return;

      if (msg.type !== "chat" || !msg.body) {
        await msg.reply("Maaf Kak, aku baru bisa membaca pesan teks. Ketik pertanyaannya ya.");
        return;
      }

      const text = msg.body.trim();
      console.log(`[${time()}] [Masuk ${mask(from)}] ${text}`);

      try {
        const chat = await msg.getChat();
        await chat.sendStateTyping();
      } catch (_) { /* indikator mengetik tidak wajib */ }

      const history = getHistory(from);
      const result = await reply({ message: text, history, channel: "wa" });
      await msg.reply(result.reply);
      saveHistory(from, text, result.reply);

      const info = result.model ? `${result.sumber}, ${result.model}` : result.sumber;
      console.log(`[${time()}] [Balas  ${mask(from)}] (${info}) ${result.reply.split("\n")[0].slice(0, 90)}...`);
    } catch (err) {
      console.error(`[${time()}] [WA] Error memproses pesan:`, err.message || err);
      try {
        await msg.reply("Maaf Kak, asistennya lagi gangguan sebentar. Coba kirim ulang pertanyaannya ya.");
      } catch (_) {}
    }
  });

  return client;
}

async function start() {
  const s = status();
  console.log(`[${time()}] [WA] Menyalakan gateway WhatsApp untuk "${s.toko}" (${s.jumlahProduk} produk)`);
  if (!s.jumlahProduk) console.log("     [!] Data produk kosong. Jalankan dulu: npm run build-data");
  console.log("     Pertama kali bisa 30-90 detik, tunggu sampai QR muncul...");

  for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt++) {
    const client = createClient();
    try {
      await client.initialize();
      setupShutdown(client);
      return;
    } catch (err) {
      console.error(`[${time()}] [WA] Gagal start (percobaan ${attempt}/${MAX_START_ATTEMPTS}): ${err.message}`);
      try { await client.destroy(); } catch (_) {}
      if (attempt < MAX_START_ATTEMPTS) {
        console.log("     Mencoba lagi dalam 5 detik...");
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
  console.error("\n[WA] Tetap gagal. Cek koneksi internet, tutup Chrome/Chromium sisa di Task Manager,");
  console.error("     atau hapus folder .wwebjs_auth dan .wwebjs_cache lalu coba lagi.");
  process.exit(1);
}

function setupShutdown(client) {
  const stop = async () => {
    console.log(`\n[${time()}] [WA] Mematikan bot...`);
    try { await client.destroy(); } catch (_) {}
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

start();
