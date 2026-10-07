/**
 * Redimensiona una foto de perfil en el navegador antes de subirla (PERF-10).
 *
 * El avatar se pinta a 72 px como mucho, pero se subía tal cual: hasta 2 MB por foto de móvil, que
 * baja todo el que abre el ranking. Aquí se recorta al cuadrado central y se reduce a
 * `AVATAR_SIZE` px, en WebP (o PNG si el navegador no sabe codificar WebP).
 *
 * Si algo falla (formato que el navegador no decodifica, sin canvas…) devuelve el fichero original:
 * subirlo grande es mejor que no dejar cambiar la foto.
 */

const AVATAR_SIZE = 256;
const AVATAR_QUALITY = 0.85;

export async function resizeAvatar(file: File): Promise<{ blob: Blob; extension: string }> {
  const original = { blob: file as Blob, extension: file.name.split(".").pop() || "jpg" };
  try {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const target = Math.min(AVATAR_SIZE, side);

    const canvas = document.createElement("canvas");
    canvas.width = target;
    canvas.height = target;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      target,
      target
    );
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", AVATAR_QUALITY)
    );
    if (!blob || blob.size >= file.size) return original;
    return { blob, extension: blob.type === "image/webp" ? "webp" : "png" };
  } catch {
    return original;
  }
}
