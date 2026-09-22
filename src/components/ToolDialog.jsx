"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export async function toolApi(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Не удалось выполнить запрос");
  return value;
}
export default function ToolDialog({ title, subtitle, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { const previous = document.activeElement; ref.current?.focus(); return () => previous?.focus?.(); }, []);
  return createPortal(<div className="ai-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="ai-dialog" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onKeyDown={(event) => {
    event.stopPropagation();
    if (event.key === "Escape") onClose();
    if (event.key === "Tab") { const items = [...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')].filter((item) => item.getClientRects().length); const first = items[0], last = items.at(-1); if (event.shiftKey && [first,ref.current].includes(document.activeElement)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  }}><header className="ai-dialog-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="secondary" onClick={onClose} aria-label="Закрыть">×</button></header><div className="ai-dialog-content">{children}</div></section></div>, document.body);
}
