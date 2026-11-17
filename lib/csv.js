// Parser CSV kecil tanpa library.
// Kenapa tidak pakai split(",") biasa? Nama produk Shopee sering mengandung koma
// dan tanda kutip, jadi baris bisa terpotong di tempat yang salah.
// Parser ini mengikuti aturan CSV standar: isi sel boleh dibungkus "...",
// dan tanda kutip di dalamnya ditulis dobel ("").

function detectDelimiter(text) {
  // Kalau CSV sempat dibuka lalu disimpan ulang di Excel (setelan Indonesia),
  // pemisahnya bisa berubah jadi titik koma. Kita hitung di baris pertama.
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  let inQuotes = false;
  let commas = 0;
  let semicolons = 0;
  let tabs = 0;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === ",") commas++;
    else if (!inQuotes && ch === ";") semicolons++;
    else if (!inQuotes && ch === "\t") tabs++;
  }
  if (tabs > commas && tabs > semicolons) return "\t";
  if (semicolons > commas) return ";";
  return ",";
}

function parseCSV(text) {
  if (!text) return [];
  // Hapus BOM (karakter tak terlihat di awal file dari beberapa aplikasi)
  text = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);

  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // Buang baris yang benar-benar kosong
  return rows.filter(r => r.some(c => String(c).trim() !== ""));
}

module.exports = { parseCSV, detectDelimiter };
