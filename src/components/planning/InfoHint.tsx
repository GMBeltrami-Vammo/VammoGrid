'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EXPLAINERS, type Explainer, type ExplainerId } from '@/lib/planning/explainers';
import { cn } from '@/lib/utils';

// A small "?" icon that opens a popover describing a computed value and its formula.
// Content comes from the EXPLAINERS registry (keyed, single source of truth).
//
// The popover is rendered into a portal (document.body) with fixed positioning, so it
// is never clipped by a table's overflow-x-auto or a card's overflow-hidden. It opens
// on hover and on click; click "pins" it open so the user can read/scroll. Closes on
// Escape, outside click, or scroll.

const WIDTH = 288; // matches Tailwind w-72

export function InfoHint({ id, className }: { id: ExplainerId; className?: string }) {
  // Widen to Explainer so optional formula/source access type-checks (EXPLAINERS uses
  // `satisfies`, which otherwise narrows each entry to its exact literal shape).
  const ex: Explainer | undefined = EXPLAINERS[id];
  const btnRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = r.left;
    if (left + WIDTH > window.innerWidth - 8) left = window.innerWidth - WIDTH - 8;
    setPos({ top: r.bottom + 6, left: Math.max(8, left) });
  }, []);

  const show = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    place();
    setOpen(true);
  }, [place]);

  const hide = useCallback(() => {
    setOpen(false);
    setPinned(false);
  }, []);

  const scheduleHide = useCallback(() => {
    if (pinned) return;
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }, [pinned]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    const onScroll = () => hide();
    const onDown = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node)) hide();
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, hide]);

  if (!ex) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={`O que é: ${ex.title}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open && pinned) hide();
          else {
            setPinned(true);
            show();
          }
        }}
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        className={cn(
          'inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-foreground/25 align-middle text-[9px] font-bold leading-none text-muted-foreground transition-colors hover:border-brand-500 hover:text-brand-600',
          className,
        )}
      >
        ?
      </button>
      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: WIDTH }}
            onMouseEnter={show}
            onMouseLeave={scheduleHide}
            className="z-[60] rounded-lg border border-foreground/15 bg-card p-3 text-left shadow-xl"
          >
            <p className="text-xs font-semibold text-foreground">{ex.title}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{ex.what}</p>
            {ex.formula && (
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted px-2 py-1.5 font-mono text-[10px] leading-relaxed text-foreground">
                {ex.formula}
              </pre>
            )}
            {ex.source && (
              <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                Fonte: {ex.source}
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
