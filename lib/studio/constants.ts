import type { AsciiParams } from "@/lib/ascii";

export const OUTPUT_SIZE = 600;
export const MAX_VIDEO_FRAMES = 90;

export const CHARSET_OPTIONS = [
  { value: "detailed", label: "Detailed" },
  { value: "blocks", label: "Blocks" },
  { value: "pixel", label: "Pixel Blocks" },
  { value: "minimal", label: "Minimal" },
  { value: "custom", label: "Custom" },
] as const;

export const PAINT_ONLY_PARAMS = new Set<keyof AsciiParams>([
  "bgColor", "fgColor", "colored", "glow", "glowColor", "glowRadius",
]);

export function computeDims(w: number, h: number) {
  const asp = w / h;
  let cw = OUTPUT_SIZE;
  let ch = OUTPUT_SIZE;
  if (asp > 1) ch = Math.round(OUTPUT_SIZE / asp);
  else cw = Math.round(OUTPUT_SIZE * asp);
  return { cw, ch };
}

export function detectMediaType(file: File): "image" | "video" | "gif" | null {
  if (file.type === "image/gif") return "gif";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "gif") return "gif";
  if (["mp4", "webm", "mov"].includes(ext ?? "")) return "video";
  if (["png", "jpg", "jpeg", "webp", "svg", "bmp"].includes(ext ?? "")) return "image";
  return null;
}
