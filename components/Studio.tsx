"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, Download, Code, RefreshCw, Check,
  Play, Pause, Type, FileVideo, Eraser,
} from "lucide-react";
import {
  imageDataToAscii,
  renderAsciiToCanvas,
  generateAsciiVideoCode,
  DEFAULT_ASCII_PARAMS,
  type AsciiParams,
  type AsciiCell,
} from "@/lib/ascii";
import { extractVideoFrames } from "@/lib/videoFrames";
import { decodeGif } from "@/lib/gifDecoder";
import { removeBackground } from "@/lib/bgErase";
import {
  CHARSET_OPTIONS,
  PAINT_ONLY_PARAMS,
  OUTPUT_SIZE,
  MAX_VIDEO_FRAMES,
  computeDims,
  detectMediaType,
} from "@/lib/studio/constants";
import Slider from "@/components/Slider";
import Toggle from "@/components/Toggle";
import Section from "@/components/studio/Section";
import ColorRow from "@/components/studio/ColorRow";

type MediaMode = "image" | "video";

const ease = [0.22, 1, 0.36, 1] as const;

export default function Studio() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const originalImageRef = useRef<HTMLImageElement | null>(null);
  const asciiFramesRef = useRef<AsciiCell[][]>([]);
  const rawFramesRef = useRef<ImageData[]>([]);
  const erasedFramesRef = useRef<ImageData[]>([]);
  const canvasSizeRef = useRef({ w: OUTPUT_SIZE, h: OUTPUT_SIZE });
  const paramsRef = useRef<AsciiParams>(DEFAULT_ASCII_PARAMS);
  const prevParamsRef = useRef<AsciiParams>(DEFAULT_ASCII_PARAMS);
  const bgEraseRef = useRef(false);
  const hasMediaRef = useRef(false);
  const isVideoRef = useRef(false);
  const isReprocessingRef = useRef(false);
  const frameIdxRef = useRef(0);
  const videoPlayingRef = useRef(false);
  const lastFrameTimeRef = useRef(0);
  const videoRafRef = useRef(0);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [params, setParams] = useState<AsciiParams>(DEFAULT_ASCII_PARAMS);
  const [mode, setMode] = useState<MediaMode>("image");
  const [hasMedia, setHasMedia] = useState(false);
  const [mediaName, setMediaName] = useState("");
  const [rendering, setRendering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [videoFrameCount, setVideoFrameCount] = useState(0);
  const [videoCurrentFrame, setVideoCurrentFrame] = useState(0);
  const [videoFps, setVideoFps] = useState(24);
  const [progressLabel, setProgressLabel] = useState("");
  const [exportingWebM, setExportingWebM] = useState(false);
  const [bgEraseEnabled, setBgEraseEnabled] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isVideo = mode === "video";
  const isLoading = isExtracting || isProcessing;
  const canvasBg = bgEraseEnabled ? "transparent" : params.bgColor;

  useEffect(() => { hasMediaRef.current = hasMedia; }, [hasMedia]);
  useEffect(() => { isVideoRef.current = isVideo; }, [isVideo]);
  useEffect(() => { bgEraseRef.current = bgEraseEnabled; }, [bgEraseEnabled]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const getActiveFrames = useCallback(() => {
    return bgEraseRef.current && erasedFramesRef.current.length === rawFramesRef.current.length
      ? erasedFramesRef.current
      : rawFramesRef.current;
  }, []);

  const repaintAscii = useCallback((cells: AsciiCell[], ap: AsciiParams) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = canvasSizeRef.current;
    renderAsciiToCanvas(canvas, cells, { ...ap, transparentBg: bgEraseRef.current }, w, h);
  }, []);

  const renderImage = useCallback((img: HTMLImageElement, ap: AsciiParams, transparent?: boolean) => {
    setRendering(true);
    const transparentBg = transparent ?? bgEraseRef.current;
    const srcW = img.naturalWidth;
    const srcH = img.naturalHeight;
    const { cw, ch } = computeDims(srcW, srcH);
    const canvas = canvasRef.current!;
    canvas.width = cw;
    canvas.height = ch;
    canvasSizeRef.current = { w: cw, h: ch };

    const off = document.createElement("canvas");
    off.width = srcW;
    off.height = srcH;
    const ctx = off.getContext("2d", { willReadFrequently: true })!;
    ctx.clearRect(0, 0, srcW, srcH);
    ctx.drawImage(img, 0, 0);
    const cells = imageDataToAscii(ctx.getImageData(0, 0, srcW, srcH), ap, cw, ch);
    renderAsciiToCanvas(canvas, cells, { ...ap, transparentBg }, cw, ch);
    setRendering(false);
  }, []);

  const reprocessFrames = useCallback(async (ap: AsciiParams) => {
    if (isReprocessingRef.current) return;
    isReprocessingRef.current = true;
    const frames = getActiveFrames();
    if (!frames.length) {
      isReprocessingRef.current = false;
      return;
    }
    const { w, h } = canvasSizeRef.current;
    const next: AsciiCell[][] = [];
    for (let i = 0; i < frames.length; i++) {
      next.push(imageDataToAscii(frames[i], ap, w, h));
      if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    asciiFramesRef.current = next;
    const idx = frameIdxRef.current;
    const frame = next[idx] ?? next[0];
    if (frame) repaintAscii(frame, ap);
    isReprocessingRef.current = false;
  }, [getActiveFrames, repaintAscii]);

  const setParam = useCallback(<K extends keyof AsciiParams>(key: K, value: AsciiParams[K]) => {
    setParams((prev) => {
      const next = { ...prev, [key]: value };
      paramsRef.current = next;

      if (isVideoRef.current && hasMediaRef.current) {
        const changed = (Object.keys(next) as (keyof AsciiParams)[]).filter((k) => next[k] !== prev[k]);
        if (changed.every((k) => PAINT_ONLY_PARAMS.has(k))) {
          const frame = asciiFramesRef.current[frameIdxRef.current];
          if (frame) repaintAscii(frame, next);
        } else {
          reprocessFrames(next);
        }
      } else if (hasMediaRef.current && imageRef.current) {
        const changed = (Object.keys(next) as (keyof AsciiParams)[]).filter((k) => next[k] !== prev[k]);
        if (changed.length === 0) return next;
        const onlyPaint = changed.every((k) => PAINT_ONLY_PARAMS.has(k));
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = setTimeout(() => {
          if (imageRef.current) renderImage(imageRef.current, paramsRef.current);
        }, onlyPaint ? 0 : 80);
      }

      prevParamsRef.current = next;
      return next;
    });
  }, [renderImage, repaintAscii, reprocessFrames]);

  const applyBgErase = useCallback((img: HTMLImageElement, enabled: boolean): Promise<HTMLImageElement> => {
    if (!enabled) return Promise.resolve(img);
    const off = document.createElement("canvas");
    off.width = img.width;
    off.height = img.height;
    const ctx = off.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const erased = removeBackground(ctx.getImageData(0, 0, img.width, img.height));
    ctx.putImageData(erased, 0, 0);
    return new Promise((resolve) => {
      const result = new Image();
      result.onload = () => resolve(result);
      result.src = off.toDataURL();
    });
  }, []);

  const processFrameBatch = useCallback(async (
    frames: ImageData[],
    width: number,
    height: number,
    ap: AsciiParams,
    onProgress: (ratio: number, label: string) => void,
  ) => {
    const active: ImageData[] = [];
    if (bgEraseRef.current) {
      for (let i = 0; i < frames.length; i++) {
        onProgress(i / frames.length, `Removing background ${i + 1}/${frames.length}`);
        active.push(removeBackground(frames[i]));
        if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      erasedFramesRef.current = active;
    } else {
      active.push(...frames);
      erasedFramesRef.current = [];
    }

    const ascii: AsciiCell[][] = [];
    for (let i = 0; i < active.length; i++) {
      onProgress(0.35 + (i / active.length) * 0.65, `ASCII ${i + 1}/${active.length}`);
      ascii.push(imageDataToAscii(active[i], ap, width, height));
      if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    return ascii;
  }, []);

  const loadImage = useCallback((file: File) => {
    setMode("image");
    setMediaName(file.name);
    const img = new Image();
    img.onload = () => {
      originalImageRef.current = img;
      applyBgErase(img, bgEraseEnabled).then((processed) => {
        imageRef.current = processed;
        setHasMedia(true);
        renderImage(processed, paramsRef.current, bgEraseEnabled);
      });
    };
    img.src = URL.createObjectURL(file);
  }, [applyBgErase, bgEraseEnabled, renderImage]);

  const loadSequence = useCallback(async (
    file: File,
    decode: (onProgress: (ratio: number, label: string) => void) => Promise<{ frames: ImageData[]; width: number; height: number; fps?: number }>,
    extractLabel: string,
  ) => {
    setMode("video");
    setMediaName(file.name);
    setHasMedia(false);
    setIsExtracting(true);
    setVideoProgress(0);
    setProgressLabel(extractLabel);
    asciiFramesRef.current = [];
    rawFramesRef.current = [];
    frameIdxRef.current = 0;
    setVideoCurrentFrame(0);
    setVideoPlaying(false);
    videoPlayingRef.current = false;

    try {
      const { frames, width, height, fps } = await decode((ratio, label) => {
        setVideoProgress(ratio * 0.35);
        setProgressLabel(label);
      });
      if (fps) setVideoFps(fps);

      rawFramesRef.current = frames;
      const canvas = canvasRef.current!;
      canvas.width = width;
      canvas.height = height;
      canvasSizeRef.current = { w: width, h: height };
      setIsExtracting(false);
      setIsProcessing(true);

      const ascii = await processFrameBatch(frames, width, height, paramsRef.current, (ratio, label) => {
        setVideoProgress(ratio);
        setProgressLabel(label);
      });
      asciiFramesRef.current = ascii;
      setVideoFrameCount(frames.length);
      repaintAscii(ascii[0] ?? [], paramsRef.current);
      setHasMedia(true);
      setIsProcessing(false);
    } catch (e) {
      console.error(e);
      setIsExtracting(false);
      setIsProcessing(false);
      setProgressLabel(`Error — ${(e as Error).message}`);
    }
  }, [processFrameBatch, repaintAscii]);

  const loadVideo = useCallback((file: File) => {
    loadSequence(file, (onProgress) =>
      extractVideoFrames(file, videoFps, OUTPUT_SIZE, MAX_VIDEO_FRAMES, onProgress).then(({ frames, width, height }) => ({
        frames, width, height,
      })),
    "Reading video…");
  }, [loadSequence, videoFps]);

  const loadGif = useCallback((file: File) => {
    loadSequence(file, (onProgress) =>
      decodeGif(file, onProgress).then(({ frames, width, height, fps }) => ({
        frames, width, height, fps,
      })),
    "Decoding GIF…");
  }, [loadSequence]);

  const handleFile = useCallback((file: File) => {
    const type = detectMediaType(file);
    if (type === "gif") loadGif(file);
    else if (type === "video") loadVideo(file);
    else if (type === "image") loadImage(file);
  }, [loadGif, loadVideo, loadImage]);

  useEffect(() => {
    if (!hasMedia) return;
    if (isVideo) {
      if (bgEraseEnabled && erasedFramesRef.current.length === 0 && rawFramesRef.current.length > 0) {
        setIsProcessing(true);
        (async () => {
          await reprocessFrames(paramsRef.current);
          setIsProcessing(false);
        })();
      } else {
        reprocessFrames(paramsRef.current);
      }
      return;
    }
    const orig = originalImageRef.current;
    if (!orig) return;
    applyBgErase(orig, bgEraseEnabled).then((processed) => {
      imageRef.current = processed;
      renderImage(processed, paramsRef.current, bgEraseEnabled);
    });
  }, [bgEraseEnabled, hasMedia, isVideo, applyBgErase, renderImage, reprocessFrames]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.includes("image") || items[i].type.includes("video")) {
          const file = items[i].getAsFile();
          if (file) { handleFile(file); break; }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleFile]);

  useEffect(() => {
    const onDragOver = (e: DragEvent) => { e.preventDefault(); setDragging(true); };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      if (!e.relatedTarget || (e.relatedTarget as HTMLElement).nodeName === "HTML") setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) handleFile(file);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [handleFile]);

  useEffect(() => {
    if (!isVideo || !hasMedia) return;
    if (!videoPlaying) {
      const frame = asciiFramesRef.current[frameIdxRef.current];
      if (frame) repaintAscii(frame, paramsRef.current);
      return;
    }
    const interval = 1000 / videoFps;
    const loop = (time: number) => {
      if (!videoPlayingRef.current) return;
      if (time - lastFrameTimeRef.current >= interval) {
        lastFrameTimeRef.current = time;
        const total = asciiFramesRef.current.length;
        if (!total) return;
        frameIdxRef.current = (frameIdxRef.current + 1) % total;
        setVideoCurrentFrame(frameIdxRef.current);
        const frame = asciiFramesRef.current[frameIdxRef.current];
        if (frame) repaintAscii(frame, paramsRef.current);
      }
      videoRafRef.current = requestAnimationFrame(loop);
    };
    videoRafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(videoRafRef.current);
  }, [videoPlaying, isVideo, hasMedia, videoFps, repaintAscii]);

  useEffect(() => {
    if (!hasMedia || !isVideo || videoPlaying) return;
    const frame = asciiFramesRef.current[frameIdxRef.current];
    if (frame) repaintAscii(frame, params);
  }, [params.bgColor, params.fgColor, params.colored, params.glow, params.glowColor, params.glowRadius, hasMedia, isVideo, videoPlaying, repaintAscii, params]);

  const togglePlay = () => {
    const next = !videoPlaying;
    videoPlayingRef.current = next;
    setVideoPlaying(next);
  };

  const copyAsciiCode = () => {
    const { w, h } = canvasSizeRef.current;
    const frames = asciiFramesRef.current;
    if (!frames.length && imageRef.current) {
      const img = imageRef.current;
      const off = document.createElement("canvas");
      off.width = img.width;
      off.height = img.height;
      const ctx = off.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const cells = imageDataToAscii(ctx.getImageData(0, 0, img.width, img.height), paramsRef.current, w, h);
      navigator.clipboard.writeText(generateAsciiVideoCode([cells], videoFps, w, h, paramsRef.current));
    } else if (frames.length) {
      navigator.clipboard.writeText(generateAsciiVideoCode(frames, videoFps, w, h, paramsRef.current));
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportPNG = () => {
    if (!hasMedia) return;
    const { w, h } = canvasSizeRef.current;
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const cells = isVideo
      ? (asciiFramesRef.current[frameIdxRef.current] ?? asciiFramesRef.current[0] ?? [])
      : (() => {
        const img = imageRef.current;
        if (!img) return [];
        const off = document.createElement("canvas");
        off.width = img.width;
        off.height = img.height;
        const ctx = off.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        return imageDataToAscii(ctx.getImageData(0, 0, img.width, img.height), paramsRef.current, w, h);
      })();
    renderAsciiToCanvas(out, cells, { ...paramsRef.current, transparentBg: bgEraseRef.current }, w, h);
    out.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${mediaName.replace(/\.[^.]+$/, "") || "ascii"}.png`;
      a.click();
    }, "image/png");
  };

  const exportWebM = () => {
    if (!videoFrameCount) return;
    const { w, h } = canvasSizeRef.current;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = w;
    exportCanvas.height = h;
    const exportCtx = exportCanvas.getContext("2d")!;
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "video/webm";
    const recorder = new MediaRecorder(exportCanvas.captureStream(videoFps), { mimeType });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
      a.download = `${mediaName.replace(/\.[^.]+$/, "") || "ascii"}.webm`;
      a.click();
      setExportingWebM(false);
    };
    setExportingWebM(true);
    recorder.start(100);
    let fi = 0;
    const total = asciiFramesRef.current.length;
    const interval = 1000 / videoFps;
    const renderFrame = () => {
      if (fi >= total) { setTimeout(() => recorder.stop(), 200); return; }
      renderAsciiToCanvas(exportCanvas, asciiFramesRef.current[fi] ?? [], { ...paramsRef.current, transparentBg: bgEraseRef.current }, w, h);
      fi++;
      setTimeout(renderFrame, interval);
    };
    renderFrame();
  };

  const resetParams = () => {
    setParams(DEFAULT_ASCII_PARAMS);
    paramsRef.current = DEFAULT_ASCII_PARAMS;
    prevParamsRef.current = DEFAULT_ASCII_PARAMS;
    if (imageRef.current && !isVideo) renderImage(imageRef.current, DEFAULT_ASCII_PARAMS);
    else if (isVideo && asciiFramesRef.current.length) reprocessFrames(DEFAULT_ASCII_PARAMS);
  };

  return (
    <div style={{ display: "flex", height: "100dvh", background: "var(--bg)", overflow: "hidden", position: "relative" }}>
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: "absolute", inset: 0, zIndex: 90, background: "rgba(0,0,0,0.5)" }}
        />
      )}

      <motion.aside
        className={`sidebar${isMobile && !sidebarOpen ? " collapsed" : ""}`}
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.55, ease }}
        style={{
          width: 268,
          flexShrink: 0,
          background: "var(--surface)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          zIndex: 100,
        }}
      >
        <div className="drag-handle" onClick={() => setSidebarOpen((o) => !o)} />

        <header style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em" }}>asciify</span>
            <button type="button" onClick={resetParams} title="Reset" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4 }}>
              <RefreshCw size={12} />
            </button>
          </div>
          {hasMedia && (
            <div style={{ marginTop: 8, display: "flex", gap: 6, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "var(--muted)" }}>
              {isVideo && <span><span style={{ color: "var(--accent)" }}>{videoFrameCount}</span> frames</span>}
              {(rendering || isLoading) && <span style={{ color: "var(--accent)", marginLeft: "auto" }}>{isLoading ? `${Math.round(videoProgress * 100)}%` : "··"}</span>}
            </div>
          )}
        </header>

        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
          <button
            type="button"
            onClick={() => setBgEraseEnabled((b) => !b)}
            className={bgEraseEnabled ? "btn-primary" : "btn-ghost"}
            style={{ width: "100%", borderRadius: 8, padding: "8px 0", fontSize: 11 }}
          >
            <Eraser size={11} /> {bgEraseEnabled ? "Background removed" : "Remove background"}
          </button>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          <Section title="Characters" index={0}>
            <select className="select-field" value={params.charset} onChange={(e) => setParam("charset", e.target.value as AsciiParams["charset"])}>
              {CHARSET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {params.charset === "custom" && (
              <input
                value={params.customCharset}
                onChange={(e) => setParam("customCharset", e.target.value)}
                placeholder="@#%+:. "
                style={{ background: "var(--row-bg)", border: "1px solid var(--border)", color: "var(--text)", padding: "6px 10px", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", borderRadius: 8, outline: "none", width: "100%" }}
              />
            )}
          </Section>

          <Section title="Type & spacing" index={1}>
            <Slider label="FONT SIZE" value={params.fontSize} min={4} max={24} step={1} onChange={(v) => setParam("fontSize", v)} unit="px" />
            <Slider label="CHAR SPACING" value={params.charSpacing} min={0.4} max={2} step={0.05} decimals={2} onChange={(v) => setParam("charSpacing", v)} unit="×" />
            <Slider label="LINE SPACING" value={params.lineSpacing} min={0.8} max={2.5} step={0.05} decimals={2} onChange={(v) => setParam("lineSpacing", v)} unit="×" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 3 }}>
              {(["monospace", "courier", "consolas"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setParam("fontFamily", f)}
                  className={params.fontFamily === f ? "btn-primary" : "btn-ghost"}
                  style={{ borderRadius: 6, padding: "7px 4px", fontSize: 9, textTransform: "capitalize" }}
                >
                  {f}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Tone" index={2}>
            <Slider label="CONTRAST" value={params.contrast} min={-100} max={100} step={1} onChange={(v) => setParam("contrast", v)} />
            <Slider label="BRIGHTNESS" value={params.brightness} min={-100} max={100} step={1} onChange={(v) => setParam("brightness", v)} />
            <Slider label="GAMMA" value={params.gamma} min={0.2} max={3} step={0.05} decimals={2} onChange={(v) => setParam("gamma", v)} />
            <Toggle label="INVERT" value={params.invertBrightness} onChange={(v) => setParam("invertBrightness", v)} />
          </Section>

          <Section title="Colors" index={3}>
            <Toggle label="SOURCE COLORS" value={params.colored} onChange={(v) => setParam("colored", v)} />
            {!params.colored && <ColorRow label="Characters" value={params.fgColor} onChange={(v) => setParam("fgColor", v)} />}
            <ColorRow label="Background" value={params.bgColor} onChange={(v) => setParam("bgColor", v)} />
            <Toggle label="GLOW" value={params.glow} onChange={(v) => setParam("glow", v)} />
            {params.glow && (
              <>
                <ColorRow label="Glow" value={params.glowColor} onChange={(v) => setParam("glowColor", v)} />
                <Slider label="GLOW RADIUS" value={params.glowRadius} min={1} max={20} step={1} onChange={(v) => setParam("glowRadius", v)} unit="px" />
              </>
            )}
          </Section>

          {isVideo && (
            <Section title="Video" index={4}>
              <Slider label="EXTRACT FPS" value={videoFps} min={6} max={60} step={1} onChange={setVideoFps} unit="fps" />
            </Section>
          )}
        </div>

        <motion.footer
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.35, ease }}
          style={{ padding: "12px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}
        >
          <button type="button" onClick={exportPNG} disabled={!hasMedia} className="btn-primary" style={{ borderRadius: 8, padding: "7px 10px", fontSize: 10 }}>
            <Download size={11} /> Export PNG
          </button>
          <button type="button" onClick={copyAsciiCode} disabled={!hasMedia} className="btn-ghost" style={{ borderRadius: 8, padding: "7px 10px", fontSize: 10 }}>
            {copied ? <Check size={11} /> : <Code size={11} />} {copied ? "Copied!" : "Copy player JS"}
          </button>
          {videoFrameCount > 0 && (
            <button type="button" onClick={exportWebM} disabled={!hasMedia || exportingWebM} className="btn-ghost" style={{ borderRadius: 8, padding: "7px 10px", fontSize: 10 }}>
              <FileVideo size={11} /> {exportingWebM ? "Recording…" : "Export WebM"}
            </button>
          )}
        </motion.footer>
      </motion.aside>

      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.55, delay: 0.08, ease }}
        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <AnimatePresence>
          {isVideo && hasMedia && !isLoading && (
            <motion.div
              key="video-controls"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease }}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, borderBottom: "1px solid var(--border)", padding: "8px 12px" }}
            >
            <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "var(--muted)" }}>
              {videoCurrentFrame + 1}/{videoFrameCount}
            </span>
            <button type="button" onClick={togglePlay} className="btn-ghost" style={{ borderRadius: 8, padding: "5px 12px", fontSize: 10 }}>
              {videoPlaying ? <Pause size={11} /> : <Play size={11} />} {videoPlaying ? "Pause" : "Play"}
            </button>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.12, ease }}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: bgEraseEnabled ? "repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 0 0 / 16px 16px" : canvasBg,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <motion.canvas
            ref={canvasRef}
            key={hasMedia ? "loaded" : "empty"}
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease }}
            style={{ maxWidth: "100%", maxHeight: "100%" }}
          />

          <AnimatePresence>
            {!hasMedia && !isLoading && (
              <motion.button
                key="dropzone"
                type="button"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.45, delay: 0.15, ease }}
                onClick={() => fileInputRef.current?.click()}
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                background: dragging ? "rgba(109,157,255,0.08)" : "transparent",
                border: dragging ? "2px dashed var(--accent)" : "2px dashed transparent",
                cursor: "pointer",
              }}
            >
              <Type size={28} color="var(--muted)" />
              <div style={{ textAlign: "center" }}>
                <p style={{ fontWeight: 500, fontSize: 14 }}>Drop an image or video</p>
                <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>PNG · JPG · GIF · MP4</p>
              </div>
              </motion.button>
            )}

            {isLoading && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease }}
                style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "var(--bg)" }}
              >
              <div style={{ width: 260, height: 2, background: "var(--border)", borderRadius: 1, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${videoProgress * 100}%`, background: "var(--accent)", transition: "width 0.2s" }} />
              </div>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "var(--muted)" }}>{progressLabel}</span>
              </motion.div>
            )}

            {hasMedia && !isLoading && (
              <motion.button
                key="change-file"
                type="button"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.4, ease }}
                onClick={() => fileInputRef.current?.click()}
              style={{ position: "absolute", bottom: 14, right: 14, background: "none", border: "none", cursor: "pointer" }}
            >
              <span className="btn-ghost" style={{ borderRadius: 8, padding: "6px 14px", fontSize: 10, display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Upload size={10} /> Change file
              </span>
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.main>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,image/gif,video/*"
        style={{ position: "fixed", opacity: 0, width: 0, height: 0, pointerEvents: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
