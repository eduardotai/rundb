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
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(true);
      return;
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
