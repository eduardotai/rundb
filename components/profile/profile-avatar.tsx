import { cn } from '@/lib/utils';

interface ProfileAvatarProps {
  name: string;
  avatarUrl?: string | null;
  /** pixel size of the square avatar */
  size?: number;
  className?: string;
}

// Deterministic gradient per name so each user gets a stable, distinct identity color.
const GRADIENTS = [
  'from-stone-500 to-stone-700',
  'from-zinc-500 to-zinc-700',
  'from-slate-500 to-slate-700',
  'from-neutral-500 to-neutral-700',
  'from-[#6b70d6] to-[#3f45b3]',
  'from-[#7a8a86] to-[#4c5a57]',
  'from-[#8c7b6b] to-[#5e5045]',
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ProfileAvatar({ name, avatarUrl, size = 96, className }: ProfileAvatarProps) {
  const gradient = GRADIENTS[hashName(name || '?') % GRADIENTS.length];

  return (
    <div
      className={cn(
        'relative flex flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl ring-2 ring-background',
        className
      )}
      style={{ width: size, height: size }}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt={name}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className={cn(
            'flex h-full w-full items-center justify-center bg-gradient-to-br font-semibold text-white',
            gradient
          )}
          style={{ fontSize: size * 0.36 }}
        >
          {initials(name)}
        </div>
      )}
    </div>
  );
}
