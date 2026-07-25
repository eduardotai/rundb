'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type CountUpProps = {
  value: number;
  className?: string;
  /** Duration in ms. Default 900. */
  duration?: number;
  /** Format with locale separators. Default true. */
  format?: boolean;
};

function prefersReducedMotion() {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Smooth tabular count-up for stats (reports, games, FPS). */
export function CountUp({ value, className, duration = 900, format = true }: CountUpProps) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  const started = useRef(false);

  useEffect(() => {
    if (prefersReducedMotion()) {
      prev.current = value;
      // Defer so we never setState synchronously inside the effect body.
      const id = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(id);
    }

    const from = started.current ? prev.current : 0;
    started.current = true;
    prev.current = value;

    if (from === value) {
      const id = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(id);
    }

    let frame = 0;
    const start = performance.now();
    const delta = value - from;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + delta * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  const text = format ? display.toLocaleString() : String(display);

  return (
    <span className={cn('tabular-nums', className)} aria-label={format ? value.toLocaleString() : String(value)}>
      {text}
    </span>
  );
}
