'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, User } from 'lucide-react';
import { toast } from 'sonner';
import { showUserError } from '@/lib/toast';

interface AuthButtonProps {
  user?: {
    id: string;
    email?: string;
    user_metadata?: {
      full_name?: string;
      avatar_url?: string;
    };
  } | null;
}

export function AuthButton({ user }: AuthButtonProps) {
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleSignOut = async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
      toast.success('Signed out');
      // Refresh to clear any client state
      window.location.reload();
    } catch {
      showUserError('Failed to sign out. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (user) {
    const displayName = user.user_metadata?.full_name || user.email || 'Guest User';
    const avatarUrl = user.user_metadata?.avatar_url;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="flex items-center gap-2 px-2">
            <div className="h-8 w-8 rounded-full overflow-hidden border bg-muted flex-shrink-0 flex items-center justify-center text-xs font-medium">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={displayName}
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                displayName.charAt(0).toUpperCase()
              )}
            </div>
            <span className="hidden md:inline text-sm font-medium">
              {displayName.split(' ')[0]}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-1.5 text-sm">
            <p className="font-medium">{displayName}</p>
            {user.email && (
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            )}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => (window.location.href = '/profile')}>
            <User className="mr-2 h-4 w-4" />
            Profile & My Rig
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => (window.location.href = '/my-reports')}>
            My Reports
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => (window.location.href = '/admin')} className="text-amber-400">
            Admin Tools (Phase 4)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSignOut} disabled={loading}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Dedicated sign-in / sign-up pages now handle all auth methods (OAuth, email/password, guest).
  // Header shows simple navigation to the full pages instead of duplicating actions in a dropdown.
  return (
    <Button asChild variant="outline">
      <Link href="/auth/sign-in">Sign in</Link>
    </Button>
  );
}
