'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Extra delay in ms after entering view. */
  delay?: number;
  /** Once visible, stay visible. Default true. */
  once?: boolean;
  as?: 'div' | 'section' | 'li' | 'article';
  style?: CSSProperties;
};

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Fade + rise when element enters the viewport.
 * Uses CSS class `motion-reveal` / `motion-reveal-in` from globals.css.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  once = true,
  as: Tag = 'div',
  style,
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  // Prefer-reduced-motion users skip the entrance animation entirely.
  const [visible, setVisible] = useState(() => prefersReducedMotion());

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (prefersReducedMotion()) {
      // Already visible from initial state; keep in sync if preference flips mid-session.
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          if (once) io.disconnect();
        } else if (!once) {
          setVisible(false);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );

    io.observe(el);
    return () => io.disconnect();
  }, [once]);

  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      className={cn('motion-reveal', visible && 'motion-reveal-in', className)}
      style={{
        ...style,
        transitionDelay: visible && delay ? `${delay}ms` : undefined,
      }}
    >
      {children}
    </Tag>
  );
}
