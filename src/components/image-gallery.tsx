"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export interface GalleryImage {
  id: string;
  caption?: string | null;
}

const MIN = 1;
const MAX = 8;

/**
 * Screenshot thumbnails that open a viewer on the same page: flip through every image
 * (arrow keys or buttons) and zoom (wheel, + / -, double-click), drag to pan when zoomed.
 */
export function Gallery({
  images,
  className = "flex flex-wrap gap-2",
  thumbClass = "w-36",
  imgClass = "h-20",
  maxThumbs,
}: {
  images: GalleryImage[];
  className?: string;
  thumbClass?: string;
  imgClass?: string;
  /** Show only the newest N thumbnails; the viewer still has all of them. */
  maxThumbs?: number;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (!images.length) return null;
  const offset = maxThumbs && images.length > maxThumbs ? images.length - maxThumbs : 0;
  return (
    <>
      <div className={className}>
        {images.slice(offset).map((img, i) => (
          <button
            key={img.id}
            type="button"
            onClick={() => setOpen(offset + i)}
            className={`block overflow-hidden rounded-md border border-slate-200 bg-white text-left hover:border-slate-400 ${thumbClass}`}
            aria-label={`View screenshot${img.caption ? `: ${img.caption}` : ""} larger`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/evidence/${img.id}`} alt={img.caption ?? "screenshot"} className={`w-full object-cover object-top ${imgClass}`} loading="lazy" />
            {img.caption ? <span className="block truncate px-1.5 py-0.5 text-xs text-slate-600">{img.caption}</span> : null}
          </button>
        ))}
        {offset > 0 && (
          <button type="button" onClick={() => setOpen(0)} className="self-center text-xs text-accent-700 underline">
            +{offset} earlier
          </button>
        )}
      </div>
      {open !== null && <Viewer images={images} start={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Viewer({ images, start, onClose }: { images: GalleryImage[]; start: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(start);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const img = images[index];
  const many = images.length > 1;

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  const reset = useCallback(() => setView({ s: 1, x: 0, y: 0 }), []);
  const go = useCallback(
    (to: number) => {
      setIndex((i) => {
        const n = (to + images.length) % images.length;
        return n === i ? i : n;
      });
      reset();
    },
    [images.length, reset],
  );

  /** Zoom to scale `next`, keeping the point under (cx, cy) (relative to the stage centre) fixed. */
  const zoomTo = useCallback((next: number, cx = 0, cy = 0) => {
    setView((v) => {
      const s = Math.min(MAX, Math.max(MIN, next));
      if (s === MIN) return { s, x: 0, y: 0 };
      const k = s / v.s;
      return { s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  }, []);

  const centre = (clientX: number, clientY: number) => {
    const r = stage.current!.getBoundingClientRect();
    return { cx: clientX - (r.left + r.width / 2), cy: clientY - (r.top + r.height / 2) };
  };

  // Wheel zoom needs a non-passive listener to stop the page behind from scrolling.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { cx, cy } = centre(e.clientX, e.clientY);
      setView((v) => {
        const s = Math.min(MAX, Math.max(MIN, v.s * Math.exp(-e.deltaY * 0.0015)));
        if (s === MIN) return { s, x: 0, y: 0 };
        const k = s / v.s;
        return { s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
      else if (e.key === "+" || e.key === "=") zoomTo(view.s * 1.4);
      else if (e.key === "-") zoomTo(view.s / 1.4);
      else if (e.key === "0") reset();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, reset, view.s, zoomTo]);

  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [index]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (view.s <= 1) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setView((v) => ({ ...v, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onDouble = (e: React.MouseEvent) => {
    const { cx, cy } = centre(e.clientX, e.clientY);
    if (view.s > 1) reset();
    else zoomTo(2.5, cx, cy);
  };

  const btn = "rounded border border-white/30 bg-white/10 px-2.5 py-1 text-sm text-white hover:bg-white/20 disabled:opacity-40";

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-label="Screenshot viewer"
      className="m-0 h-screen max-h-none w-screen max-w-none overflow-hidden bg-transparent p-0 backdrop:bg-black/85"
    >
      <div className="flex h-full flex-col text-white">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2">
          <p className="min-w-0 flex-1 truncate text-sm">
            <span className="text-white/60">{many ? `${index + 1} / ${images.length}` : ""}</span> {img.caption ?? "Screenshot"}
          </p>
          <button type="button" className={btn} onClick={() => zoomTo(view.s / 1.4)} aria-label="Zoom out" disabled={view.s <= MIN}>−</button>
          <span className="w-12 text-center text-xs tabular-nums" aria-live="polite">{Math.round(view.s * 100)}%</span>
          <button type="button" className={btn} onClick={() => zoomTo(view.s * 1.4)} aria-label="Zoom in" disabled={view.s >= MAX}>+</button>
          <button type="button" className={btn} onClick={reset}>Fit</button>
          <a className={btn} href={`/api/evidence/${img.id}`} target="_blank" rel="noreferrer">Open original</a>
          <button type="button" className={btn} onClick={() => dialog.current?.close()} aria-label="Close viewer">Close</button>
        </div>

        <div className="relative min-h-0 flex-1">
          <div
            ref={stage}
            className={`absolute inset-0 touch-none overflow-hidden ${view.s > 1 ? (drag.current ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={onDouble}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={img.id}
              src={`/api/evidence/${img.id}`}
              alt={img.caption ?? "screenshot"}
              draggable={false}
              className="h-full w-full select-none object-contain"
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transition: drag.current ? "none" : "transform 80ms ease-out" }}
            />
          </div>
          {many && (
            <>
              <button type="button" className={`${btn} absolute top-1/2 left-3 -translate-y-1/2 !px-3 !py-3 text-lg`} onClick={() => go(index - 1)} aria-label="Previous screenshot">‹</button>
              <button type="button" className={`${btn} absolute top-1/2 right-3 -translate-y-1/2 !px-3 !py-3 text-lg`} onClick={() => go(index + 1)} aria-label="Next screenshot">›</button>
            </>
          )}
        </div>

        {many && (
          <div ref={strip} className="flex gap-2 overflow-x-auto px-4 py-2" role="list" aria-label="All screenshots">
            {images.map((t, i) => (
              <button
                key={t.id}
                type="button"
                role="listitem"
                aria-current={i === index}
                aria-label={t.caption ?? `Screenshot ${i + 1}`}
                onClick={() => go(i)}
                className={`h-14 w-24 shrink-0 overflow-hidden rounded border-2 ${i === index ? "border-white" : "border-transparent opacity-60 hover:opacity-100"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/evidence/${t.id}`} alt="" className="h-full w-full object-cover object-top" loading="lazy" />
              </button>
            ))}
          </div>
        )}
        <p className="px-4 pb-2 text-xs text-white/60">
          {many ? "← → switch · " : ""}wheel, + / − or double-click to zoom · drag to move when zoomed · 0 to fit · Esc to close
        </p>
      </div>
    </dialog>
  );
}
