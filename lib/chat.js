// Otak chatbot. Dipakai bersama oleh website (api/chat.js) dan WhatsApp (gateway/wa.js),
// jadi jawaban di dua tempat itu selalu dari data dan logika yang sama.
//
// Alur jawaban berlapis (yang sederhana dijawab tanpa AI supaya hemat kuota):
//   1. Sapaan / terima kasih          -> template
//   2. Pertanyaan umum (FAQ)          -> jawaban dari data/knowledge.json
//   3. Pertanyaan produk              -> RAG: cari produk -> susun konteks -> Groq LLM
//   4. Groq gagal / API key kosong    -> jawaban cadangan langsung dari hasil RAG

require("dotenv").config({ quiet: true });
const Groq = require("groq-sdk");
const rag = require("./rag");
const { keywordMatcher } = require("./normalize");
const knowledge = require("../data/knowledge.json");

const TOKO = knowledge.toko || {};
const NAMA_TOKO = TOKO.nama || "Toko";
const MAX_HISTORY = 8;

// ---------------- Groq ----------------
let groqClient = null;
function groqConfigured() {
  const key = process.env.GROQ_API_KEY || "";
  return key.startsWith("gsk_") && !/isi_api_key/i.test(key);
}
function getGroq() {
  if (!groqConfigured()) return null;
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY, timeout: 20000, maxRetries: 1 });
  }
  return groqClient;
}
function modelList() {
  const utama = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";
  const cadangan = (process.env.GROQ_FALLBACK_MODELS || "openai/gpt-oss-20b,llama-3.1-8b-instant")
    .split(",").map(s => s.trim()).filter(Boolean);
  return [...new Set([utama, ...cadangan])];
}

function stripThinking(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .trim();
}

async function callGroq(messages) {
  const groq = getGroq();
  if (!groq) return null;
  const maxTokens = Number(process.env.GROQ_MAX_TOKENS || 700);

  for (const model of modelList()) {
    const params = { model, messages, max_tokens: maxTokens, temperature: 0.3 };
    // Model Qwen3 bisa "berpikir" dulu dan menghabiskan token; dimatikan supaya langsung menjawab.
    if (/qwen3/i.test(model)) params.reasoning_effort = "none";

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const completion = await groq.chat.completions.create(params);
        const text = stripThinking(completion.choices?.[0]?.message?.content);
        if (text) return { text, model };
        console.warn(`[Groq ${model}] jawaban kosong, coba model berikutnya`);
        break;
      } catch (err) {
        const msg = err?.error?.error?.message || err.message || String(err);
        if (attempt === 0 && params.reasoning_effort && /reasoning/i.test(msg)) {
          delete params.reasoning_effort; // model ini tidak mendukung opsi itu, ulangi tanpa opsi
          continue;
        }
        console.warn(`[Groq ${model}] gagal: ${msg}`);
        break;
      }
    }
  }
  return null;
}

// ---------------- Template & FAQ ----------------
const THANKS = /^(makasih|makasi|mksh|terima ?kasih|trims|thanks|thank you|thx|tq|ty|nuhun|matur nuwun|suwun|oke makasih|ok makasih|siap makasih)\b/i;

function greetingReply(history, channel) {
  const b = channel === "wa" ? "*" : "**";
  if (history.length) return `Halo lagi, Kak! Ada produk lain yang mau ditanyain?`;
  return (
    `Halo Kak, selamat datang di ${b}${NAMA_TOKO}${b}!\n\n` +
    `Aku bisa bantu cariin produk ${TOKO.brand || ""} yang cocok, misalnya:\n` +
    `• sunscreen untuk kulit berminyak\n` +
    `• serum buat jerawat\n` +
    `• moisturizer di bawah 100rb\n\n` +
    `Mau cari apa hari ini?`
  );
}

function thanksReply() {
  return `Sama-sama, Kak! Kalau sudah mantap, langsung checkout lewat link Shopee-nya ya. Semoga cocok di kulit!`;
}

const FAQ = (knowledge.faq || []).map(f => ({ ...f, matchers: (f.kata_kunci || []).map(keywordMatcher) }));

function fillVars(text) {
  return String(text)
    .replace(/\{toko\}/g, NAMA_TOKO)
    .replace(/\{shopee_url\}/g, TOKO.shopee_url || "")
    .replace(/\{whatsapp\}/g, TOKO.whatsapp || "");
}

function matchFAQ(q) {
  return FAQ.find(f => f.matchers.some(m => m(q))) || null;
}

// ---------------- Format teks ----------------
function formatForChannel(text, channel) {
  let t = String(text || "").replace(/\r/g, "");
  t = t.replace(/^#{1,6}\s*(.+)$/gm, "$1"); // heading markdown -> teks biasa
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1: $2"); // [teks](link) -> teks: link
  t = t.replace(/```/g, "");
  if (channel === "wa") {
    t = t.replace(/\*\*(.+?)\*\*/g, "*$1*");
    t = t.replace(/^\s*[-*]\s+/gm, "• ");
  }
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------- Pertanyaan lanjutan ----------------
const FOLLOW_UP_START = /^(yang|yg|kalau|kalo|klo|kl|terus|trus|lalu|itu|ini|dia|nah|oh|oke|ok|selain|ada yang|ada yg|bedanya|lebih|mana|brp|berapa)\b/i;
const GLOBAL_WORDS = /\b(produk|semua|toko|lapak|katalog)\b/i;

function isFollowUp(message, info) {
  if (!info.adaSinyal) return true; // "berapa harganya?", "linknya mana?"
  const tanpaObjek = !info.kategori.length && !info.kataKunci.length;
  if (!tanpaObjek) return false;
  if (GLOBAL_WORDS.test(message)) return false;
  const kata = message.trim().split(/\s+/).length;
  return FOLLOW_UP_START.test(message.trim()) || kata <= 5;
}

function hasObject(info) {
  return info.kategori.length > 0 || info.kataKunci.length > 0;
}

// Mundur dari pesan user terakhir, kumpulkan pesan lanjutan sampai ketemu pesan
// yang menyebut produk/kategori. Contoh: "ada sunscreen apa aja?" -> "yang paling murah?"
// -> "berapa harganya?" tetap dianggap membahas sunscreen.
function previousTopic(history) {
  const userMsgs = history.filter(h => h.role === "user").slice(-4).reverse();
  const chain = [];
  for (const h of userMsgs) {
    const info = rag.search(h.content).info;
    chain.unshift(h.content);
    if (hasObject(info)) return chain.join(" ");
  }
  return null;
}

function retrieve(message, history, now) {
  if (history.length && isFollowUp(message, now.info)) {
    const prev = previousTopic(history);
    if (prev) {
      const merged = rag.search(`${prev} ${message}`, {
        override: {
          maksud: now.info.maksud && now.info.maksud !== "rekomendasi" ? now.info.maksud : undefined,
          hargaMin: now.info.hargaMin,
          hargaMaks: now.info.hargaMaks
        }
      });
      return { result: merged, query: `${prev} ${message}`, lanjutan: true };
    }
  }
  return { result: now, query: message, lanjutan: false };
}

// ---------------- System prompt ----------------
function systemPrompt(context, channel) {
  const format = channel === "wa"
    ? "Format WhatsApp: tebal pakai SATU bintang *seperti ini*, daftar pakai •, link ditulis polos (jangan format [teks](link)), tanpa tabel, tanpa heading."
    : "Format: tebal pakai **seperti ini**, daftar pakai -, link ditulis polos (jangan format [teks](link)), tanpa tabel, tanpa heading.";

  const faqText = FAQ.map(f => `- ${f.id.replace(/_/g, " ")}: ${fillVars(f.jawaban).replace(/\n/g, " ")}`).join("\n");

  return `Kamu asisten belanja untuk katalog lapak "${NAMA_TOKO}" di Shopee. Kamu membantu pembeli memilih produk ${TOKO.brand || ""}.

ATURAN DATA (paling penting):
1. Jawab HANYA dari DATA PRODUK dan INFO TOKO di bawah. Jangan mengarang produk, harga, varian, ukuran, kandungan, promo, atau stok yang tidak tertulis.
2. Nama produk, harga, dan link disalin persis dari data. Setiap produk yang kamu sebut wajib disertai harga dan link Shopee-nya.
3. Manfaat produk hanya boleh disimpulkan dari kata di nama produknya (misalnya "Acne" berarti untuk jerawat, "Brightening" untuk mencerahkan, "Ceramide" untuk skin barrier). Jangan menambah klaim lain.
4. Kalau produk yang ditanya tidak ada di data, bilang belum ada di katalog lapak ini, lalu tawarkan produk yang ada dan paling mendekati.
5. Harga bisa berubah saat promo. Kalau pembeli butuh harga pasti, sarankan cek di link Shopee.
6. Untuk keluhan kulit berat (iritasi parah, alergi, jerawat meradang luas, hamil/menyusui), sarankan konsultasi ke dokter kulit. Jangan mendiagnosis.
7. Pertanyaan di luar urusan toko dan skincare: tolak dengan sopan, arahkan kembali ke produk.

GAYA:
- Bahasa Indonesia santai dan sopan, panggil pembeli "Kak". Singkat, langsung ke inti.
- Paling banyak 5 produk per jawaban, satu produk per butir.
- Jangan menyebut kata "data", "konteks", "CSV", "sistem", atau "scraping" ke pembeli.
- Jangan mengulang "selamat datang" kalau percakapan sudah berjalan.
- ${format}

INFO TOKO:
- Nama lapak: ${NAMA_TOKO}
- Link lapak Shopee: ${TOKO.shopee_url || "-"}
- Pembelian dan pembayaran dilakukan di Shopee.
${faqText}

${context}`;
}

// ---------------- Jawaban cadangan (tanpa AI) ----------------
function fallbackReply(result, channel) {
  const b = channel === "wa" ? "*" : "**";
  const { produk, info } = result;
  if (!produk.length) {
    return "Maaf Kak, aku belum menemukan produk yang cocok di katalog. Coba sebut jenis produknya (sunscreen, serum, moisturizer, cleanser) atau masalah kulitnya (jerawat, kusam, berminyak) ya.";
  }
  const judul = [];
  if (info.kategori.length) judul.push(info.kategori.join(" & ").toLowerCase());
  if (info.masalahKulit.length) judul.push(`untuk ${info.masalahKulit.join(", ")}`);
  if (info.hargaMaks) judul.push(`di bawah ${rag.rupiah(info.hargaMaks)}`);
  const urutan = { termurah: " (termurah dulu)", termahal: " (termahal dulu)", terlaris: " (terlaris dulu)", rating: " (rating tertinggi dulu)", diskon: " (diskon terbesar dulu)" }[info.maksud] || "";
  const lines = produk.slice(0, 5).map(p => {
    const meta = [rag.rupiah(p.harga), p.rating ? `rating ${p.rating}` : null, p.terjual_teks ? `${p.terjual_teks} terjual` : null]
      .filter(Boolean).join(" · ");
    return `• ${b}${p.nama}${b}\n  ${meta}${p.link ? `\n  ${p.link}` : ""}`;
  });
  return `Ini produk ${judul.join(" ") || "yang cocok"}${urutan}, Kak:\n\n${lines.join("\n\n")}\n\nMau aku carikan yang lain?`;
}

// Produk mana saja yang benar-benar disebut di jawaban (untuk kartu produk di website)
function mentionedProducts(text, candidates) {
  const t = String(text).toLowerCase();
  return candidates.filter(p => {
    if (p.link && t.includes(p.link.toLowerCase())) return true;
    const head = p.nama.toLowerCase().slice(0, 28);
    return head.length >= 12 && t.includes(head);
  });
}

function slimProduct(p) {
  return {
    id: p.id, nama: p.nama, kategori: p.kategori, harga: p.harga, harga_asli: p.harga_asli,
    rating: p.rating, terjual_teks: p.terjual_teks, link: p.link, gambar: p.gambar
  };
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(h => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
    .slice(-MAX_HISTORY)
    .map(h => ({ role: h.role, content: h.content.slice(0, 1500) }));
}

// ---------------- Fungsi utama ----------------
async function reply({ message, history = [], channel = "web" }) {
  const text = String(message || "").trim().slice(0, 500);
  const hist = cleanHistory(history);
  const q = text.toLowerCase();

  if (!text) {
    return { reply: "Ketik pertanyaanmu dulu ya, Kak.", sumber: "template", produk: [] };
  }

  // 1. Template
  if (rag.isGreeting(q)) {
    return { reply: formatForChannel(greetingReply(hist, channel), channel), sumber: "template", produk: [] };
  }
  if (THANKS.test(q) && q.split(/\s+/).length <= 6) {
    return { reply: thanksReply(), sumber: "template", produk: [] };
  }

  // 2. FAQ (hanya kalau pesan ini tidak sedang menyebut produk/kategori tertentu)
  const now = rag.search(text);
  const faq = matchFAQ(q);
  if (faq && !hasObject(now.info)) {
    return { reply: formatForChannel(fillVars(faq.jawaban), channel), sumber: "faq", faq: faq.id, produk: [] };
  }

  // 3. RAG: cari produk (pertanyaan lanjutan digabung dengan topik sebelumnya)
  const { result, query, lanjutan } = retrieve(text, hist, now);

  // 4. LLM dengan konteks RAG
  const context = rag.buildContext(result);
  const messages = [
    { role: "system", content: systemPrompt(context, channel) },
    ...hist,
    { role: "user", content: text }
  ];
  const debug = { queryPencarian: query, lanjutan, info: result.info, jumlahKonteks: result.produk.length };

  const ai = await callGroq(messages);
  if (ai) {
    const out = formatForChannel(ai.text, channel);
    return {
      reply: out,
      sumber: "rag+llm",
      model: ai.model,
      produk: mentionedProducts(out, result.produk).slice(0, 4).map(slimProduct),
      debug
    };
  }

  // 5. Cadangan tanpa AI
  const cadangan = (faq ? fillVars(faq.jawaban) + "\n\n" : "") + fallbackReply(result, channel);
  return {
    reply: formatForChannel(cadangan, channel),
    sumber: groqConfigured() ? "rag-cadangan (Groq gagal)" : "rag-cadangan (API key belum diisi)",
    produk: result.produk.slice(0, 4).map(slimProduct),
    debug
  };
}

function status() {
  const produk = rag.getProducts();
  return {
    status: "ok",
    toko: NAMA_TOKO,
    jumlahProduk: produk.length,
    jumlahKategori: new Set(produk.map(p => p.kategori)).size,
    groqTerpasang: groqConfigured(),
    model: modelList()[0]
  };
}

module.exports = { reply, status, formatForChannel };
