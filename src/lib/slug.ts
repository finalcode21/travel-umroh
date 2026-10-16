/**
 * Normalisasi teks bahasa Indonesia/Inggris menjadi slug URL-friendly.
 * - Huruf → ASCII kecil (termasuk aksara Latin umum).
 * - Spasi & pemisah → `-`.
 * - Sisanya (angka dijaga, simbol dihapus).
 */
export function toSlug(raw: string, maxLength = 60): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    // Peta karakter Latin umum yang punya makna sama ke ASCII.
    .replace(/àáâäãåā/g, "a")
    .replace(/èéêëē/g, "e")
    .replace(/ìíîïī/g, "i")
    .replace(/òóôöõō/g, "o")
    .replace(/ùúûüū/g, "u")
    .replace(/çćč/g, "c")
    .replace(/ñńň/g, "n")
    .replace(/šşŝ/s, "s")
    .replace(/žżź/g, "z")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized.length === 0) {
    return `tenant-${Math.random().toString(36).slice(2, 6)}`;
  }

  return normalized.slice(0, maxLength);
}

/**
 * Taruh saja invariant: slug unik kalau belum pernah dipakai.
 * Fungsi ini TIDAK memeriksa database; pengujian idempoten berada di
 * provisioning.
 */
export function suggestSlug(name: string, hashSuffix?: string): string {
  const base = toSlug(name);

  if (!hashSuffix) {
    return base;
  }

  // Taruh saja kontrak: slug + "-" + hash → tetap unik.
  const spare = `${base}-${hashSuffix}`;
  return spare.length <= 64 ? spare : base.slice(0, 64 - hashSuffix.length - 1) + "-" + hashSuffix;
}

/**
 * Hash deterministik pendek dari teks (bukan kriptografis; cukup untuk suffix
 * slug antarklien). Digunakan oleh provisioning saat terjadi bentrok slug.
 */
export function shortHash(input: string, length = 6): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(36);
  return hex.slice(-length);
}
