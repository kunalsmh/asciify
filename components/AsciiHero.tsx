"use client";

import { useRef, useEffect } from "react";

const CHARSET = " .·:+xX#@";

export default function AsciiHero({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const W = canvas.width;
    const H = canvas.height;
    const FONT_SIZE = 7;
    const COLS = Math.floor(W / (FONT_SIZE * 0.6));
    const ROWS = Math.floor(H / FONT_SIZE);

    const off = document.createElement("canvas");
    off.width = COLS;
    off.height = ROWS;
    const offCtx = off.getContext("2d")!;

    const drawLogo = (offsetX: number, offsetY: number) => {
      offCtx.clearRect(0, 0, COLS, ROWS);
      offCtx.fillStyle = "#0f0f19";
      offCtx.fillRect(0, 0, COLS, ROWS);

      const cx = COLS / 2 + offsetX;
      const cy = ROWS / 2 + offsetY;

      const numDots = 800;
      for (let i = 0; i < numDots; i++) {
        const t = i / numDots;
        const angle = t * Math.PI * 20;
        const r = t * (ROWS * 0.4);
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r * 0.6;
        const bright = Math.sin(t * Math.PI * 4 + Date.now() / 1000) * 0.5 + 0.5;
        const px = Math.round(x);
        const py = Math.round(y);
        if (px >= 0 && px < COLS && py >= 0 && py < ROWS) {
          const b = Math.round(bright * 160);
          offCtx.fillStyle = `rgb(${Math.round(b * 0.4)},${Math.round(b * 0.6)},${b})`;
          offCtx.fillRect(px, py, 1, 1);
        }
      }

      const text = "asciify";
      for (let ci = 0; ci < text.length; ci++) {
        for (let row = 0; row < 5; row++) {
          for (let col = 0; col < 4; col++) {
            const glyph = GLYPHS[text[ci]] || 0;
            const bit = (glyph >> ((4 - row) * 4 + (3 - col))) & 1;
            if (!bit) continue;
            const px = Math.round(cx - (text.length * 2.5) + ci * 5 + col);
            const py = Math.round(cy - 3 + row);
            if (px >= 0 && px < COLS && py >= 0 && py < ROWS) {
              offCtx.fillStyle = "#e8eaf0";
              offCtx.fillRect(px, py, 1, 1);
            }
          }
        }
      }
    };

    const startTime = performance.now();

    const render = (now: number) => {
      const elapsed = now - startTime;
      const driftX = Math.sin(elapsed / 7000) * 3;
      const driftY = Math.cos(elapsed / 5000) * 2;

      drawLogo(driftX, driftY);

      const imgData = offCtx.getImageData(0, 0, COLS, ROWS);
      const data = imgData.data;

      ctx.fillStyle = "#0f0f19";
      ctx.fillRect(0, 0, W, H);

      ctx.font = `${FONT_SIZE}px 'JetBrains Mono', monospace`;
      ctx.textBaseline = "top";

      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const idx = (row * COLS + col) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
          const charIdx = Math.floor(brightness * (CHARSET.length - 1));
          const char = CHARSET[charIdx];
          if (char === " ") continue;

          const hue = 215;
          const sat = 50 + brightness * 40;
          const lit = 18 + brightness * 55;
          ctx.fillStyle = `hsl(${hue},${sat}%,${lit}%)`;
          ctx.fillText(char, col * FONT_SIZE * 0.6, row * FONT_SIZE);
        }
      }

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={420}
      height={360}
      className={className}
      style={{ display: "block" }}
    />
  );
}

const GLYPHS: Record<string, number> = {
  a: 0b01101001111110011001,
  s: 0b01101000011000111100,
  c: 0b01101000100010001110,
  i: 0b01100010001000100110,
  f: 0b11111000111010001000,
  y: 0b10011001101100010010,
};
