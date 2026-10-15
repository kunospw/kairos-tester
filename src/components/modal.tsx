"use client";
import { useEffect, useRef } from "react";

/** Accessible modal built on <dialog> (focus handling and Esc provided by the browser). */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={`m-auto w-[calc(100%-2rem)] rounded-lg border border-slate-200 p-0 shadow-xl backdrop:bg-ink-900/40 ${wide ? "max-w-4xl" : "max-w-lg"}`}
      aria-label={title}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="font-semibold text-ink-900">{title}</h2>
        <button type="button" className="rounded px-2 text-lg text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto p-4">{open && children}</div>
    </dialog>
  );
}
