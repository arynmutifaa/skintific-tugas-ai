// Endpoint chatbot untuk website.
// Di Vercel, file di folder api/ otomatis jadi serverless function: /api/chat
// Di laptop, file ini dipanggil oleh dev-server.js.
//
// POST /api/chat  { "message": "sunscreen buat kulit berminyak", "history": [...] }
// GET  /api/chat  -> cek status (jumlah produk, API key Groq terbaca atau belum)

const { reply, status } = require("../lib/chat");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return res.status(200).json(status());
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Gunakan POST" });
  }

  try {
    let body = req.body || {};
    if (typeof body === "string") body = JSON.parse(body || "{}");
    const message = String(body.message || "").slice(0, 500);
    const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

    const result = await reply({ message, history, channel: "web" });
    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/chat] error:", err);
    return res.status(500).json({
      reply: "Maaf Kak, asistennya lagi gangguan sebentar. Coba kirim ulang pertanyaannya ya.",
      sumber: "error"
    });
  }
};
