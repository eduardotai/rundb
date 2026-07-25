import { cn } from '@/lib/utils';

/** Line-art PC tower — neutral monochrome, matches x.ai / ProtonDB cousin face. */
export function HeroRigGraphic({ className }: { className?: string }) {
  return (
    <div className={cn('relative mx-auto w-full max-w-[280px]', className)} aria-hidden>
      <svg viewBox="0 0 280 300" fill="none" className="h-auto w-full">
        <ellipse cx="140" cy="160" rx="100" ry="90" fill="url(#rigGlow)" opacity="0.7" />

        {/* Soft outer rings — gold / silver / white (data-hint, not RGB gaming) */}
        <circle
          cx="140"
          cy="148"
          r="118"
          stroke="rgb(224 179 63 / 0.28)"
          strokeWidth="2.5"
          strokeDasharray="220 500"
          strokeLinecap="round"
          transform="rotate(-90 140 148)"
        />
        <circle
          cx="140"
          cy="148"
          r="108"
          stroke="rgb(255 255 255 / 0.14)"
          strokeWidth="2"
          strokeDasharray="160 500"
          strokeLinecap="round"
          transform="rotate(-35 140 148)"
        />
        <circle
          cx="140"
          cy="148"
          r="98"
          stroke="rgb(255 255 255 / 0.08)"
          strokeWidth="1.5"
          strokeDasharray="110 500"
          strokeLinecap="round"
          transform="rotate(25 140 148)"
        />

        {/* Tower chassis */}
        <rect
          x="88"
          y="52"
          width="104"
          height="196"
          rx="6"
          stroke="url(#rigStroke)"
          strokeWidth="1.75"
          fill="rgb(17 17 17 / 0.85)"
        />
        <path d="M104 68h72" stroke="rgb(255 255 255 / 0.22)" strokeWidth="1.25" />
        <path d="M104 76h72" stroke="rgb(255 255 255 / 0.12)" strokeWidth="1" />
        <path d="M104 84h72" stroke="rgb(255 255 255 / 0.08)" strokeWidth="1" />

        <rect
          x="104"
          y="98"
          width="72"
          height="88"
          rx="3"
          stroke="rgb(255 255 255 / 0.2)"
          strokeWidth="1.25"
          fill="rgb(10 10 10 / 0.7)"
        />
        <rect x="114" y="118" width="52" height="10" rx="1.5" fill="rgb(224 179 63 / 0.35)" />
        <rect x="114" y="136" width="40" height="6" rx="1" fill="rgb(255 255 255 / 0.14)" />
        <rect x="114" y="150" width="48" height="6" rx="1" fill="rgb(255 255 255 / 0.08)" />

        <circle cx="120" cy="210" r="4" stroke="rgb(255 255 255 / 0.35)" strokeWidth="1.25" />
        <rect
          x="132"
          y="206"
          width="28"
          height="8"
          rx="1.5"
          stroke="rgb(255 255 255 / 0.22)"
          strokeWidth="1"
        />
        <path d="M170 206v8" stroke="rgb(224 179 63 / 0.65)" strokeWidth="2" strokeLinecap="round" />

        <path d="M96 248h88" stroke="rgb(255 255 255 / 0.2)" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M100 254h80" stroke="rgb(255 255 255 / 0.08)" strokeWidth="1" strokeLinecap="round" />

        <circle cx="96" cy="60" r="1.5" fill="rgb(255 255 255 / 0.4)" />
        <circle cx="184" cy="60" r="1.5" fill="rgb(255 255 255 / 0.4)" />
        <circle cx="96" cy="240" r="1.5" fill="rgb(224 179 63 / 0.45)" />
        <circle cx="184" cy="240" r="1.5" fill="rgb(224 179 63 / 0.45)" />

        <defs>
          <linearGradient id="rigStroke" x1="88" y1="52" x2="192" y2="248" gradientUnits="userSpaceOnUse">
            <stop stopColor="#f5f5f5" stopOpacity="0.55" />
            <stop offset="0.5" stopColor="#e0b33f" stopOpacity="0.35" />
            <stop offset="1" stopColor="#f5f5f5" stopOpacity="0.25" />
          </linearGradient>
          <radialGradient
            id="rigGlow"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="translate(140 148) rotate(90) scale(110 100)"
          >
            <stop stopColor="#ffffff" stopOpacity="0.08" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>
    </div>
  );
}
