"use client";

/**
 * Client-side image prep for vision: validate the picked file, then
 * downscale to a compact JPEG data URL so it fits Groq's limits and
 * localStorage (persisted chat store) comfortably.
 */

const ACCEPTED = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
const MAX_INPUT_BYTES = 25 * 1024 * 1024; // reject monster files before decoding
const MAX_DIMENSION = 1280; // plenty for "what's in this image?" accuracy
const JPEG_QUALITY = 0.85;

export interface ImageAttachment {
  id: string;
  name: string;
  sizeKb: number;
  /** Downscaled JPEG data URL — sent to /api/vision and shown as a chip. */
  dataUrl: string;
}

/** Throws Error with a user-facing message on invalid/oversized files. */
export async function fileToImageAttachment(file: File): Promise<ImageAttachment> {
  if (!ACCEPTED.includes(file.type)) {
    throw new Error(`Unsupported format — use PNG, JPEG, WebP or GIF (got ${file.type || "unknown"}).`);
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error(`Image is too large (${(file.size / 1024 / 1024).toFixed(1)}MB) — max 25MB.`);
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable in this browser.");
        // GIF transparency → flatten onto white so JPEG encoding looks right
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Couldn't read that image — the file may be corrupt."));
    };
    img.src = objectUrl;
  });

  return {
    id: Math.random().toString(36).slice(2),
    name: file.name || "image.jpg",
    sizeKb: Math.max(1, Math.round((dataUrl.length * 0.75) / 1024)),
    dataUrl,
  };
}
