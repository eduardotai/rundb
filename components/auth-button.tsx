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
import { LogOut, User, FileText, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { showUserError } from '@/lib/toast';

interface AuthButtonProps {
  user?: {
    id: string;
    email?: string;
    username?: string;
    avatarUrl?: string;
    user_metadata?: {
      username?: string;
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
    const displayName = user.username || user.user_metadata?.username || user.user_metadata?.full_name || user.email || 'Guest User';
    const avatarUrl = user.avatarUrl;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="flex items-center gap-2 px-2">
            <div className="h-8 w-8 rounded-full overflow-hidden border bg-muted flex-shrink-0 flex items-center justify-center text-xs font-medium">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
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
        <DropdownMenuContent align="end" className="w-64 p-1.5">
          <div className="flex items-center gap-3 px-2 py-2.5">
            <div className="h-10 w-10 rounded-full overflow-hidden border border-[#334155] bg-muted flex-shrink-0 flex items-center justify-center text-sm font-semibold">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
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
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight truncate">{displayName}</p>
              {user.email && (
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              )}
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => (window.location.href = '/profile')}
            className="group cursor-pointer py-2 focus:bg-[#334155]"
          >
            <User className="mr-2 h-4 w-4 text-muted-foreground group-focus:text-foreground" />
            <span className="flex-1">Profile &amp; My Rig</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => (window.location.href = '/my-reports')}
            className="group cursor-pointer py-2 focus:bg-[#334155]"
          >
            <FileText className="mr-2 h-4 w-4 text-muted-foreground group-focus:text-foreground" />
            <span className="flex-1">My Reports</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleSignOut}
            disabled={loading}
            className="cursor-pointer py-2 text-red-400 focus:bg-red-500/10 focus:text-red-400"
          >
            <LogOut className="mr-2 h-4 w-4" />
            {loading ? 'Signing out…' : 'Sign out'}
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
