'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { showUserError, showUserSuccess } from '@/lib/toast';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { sanitizeEmail, sanitizePassword } from '@/lib/sanitize';
import { getSafeAuthRedirectPath } from '@/lib/auth-redirect';

// Brand icons for OAuth buttons (kept inline to avoid extra deps)
function GoogleIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.51h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.34z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function DiscordIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="#5865F2" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.127c.126-.094.252-.192.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.1.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.834 19.834 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

const emailSignInSchema = z.object({
  email: z.string()
    .trim()
    .min(5, 'Please enter your email address')
    .max(254, 'Email address is too long')
    .email('Please enter a valid email address')
    .transform((val) => sanitizeEmail(val)),
  password: z.string()
    .min(1, 'Password is required')
    .max(128, 'Password is too long')
    .transform((val) => sanitizePassword(val)),
});

type EmailSignInValues = z.infer<typeof emailSignInSchema>;

function SignInForm() {
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const next = getSafeAuthRedirectPath(searchParams.get('next'));

  const supabase = createClient();

  const form = useForm<EmailSignInValues>({
    resolver: zodResolver(emailSignInSchema) as any,
    defaultValues: { email: '', password: '' },
  });

  // If already authenticated, redirect away (supports direct visits + after email confirm deep links)
  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        router.replace(next);
      }
    };
    checkUser();
  }, [router, next, supabase]);

  const handleOAuthSignIn = async (provider: 'google' | 'discord') => {
    setOauthLoading(provider);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) throw error;
      // OAuth will redirect; no further action needed here
    } catch {
      showUserError('Could not sign in with Google. Please try again.');
      setOauthLoading(null);
    }
  };

  const handleEmailSignIn = async (values: EmailSignInValues) => {
    setEmailLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });

      if (error) {
        if (error.message.includes('Email not confirmed')) {
          showUserError('Please confirm your email first. Check your inbox for the link.');
        } else if (error.message.includes('Invalid login credentials')) {
          showUserError('Invalid email or password. Check your details or sign up.');
        } else {
          throw error;
        }
        return;
      }

      showUserSuccess('Welcome back!');
      // refresh() re-renders server components (e.g. SiteHeader) with the new auth
      // cookie so the logged-in state shows immediately, without a manual reload.
      router.push(next);
      router.refresh();
    } catch {
      showUserError('Sign in failed. Please check your email and password.');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleGuestSignIn = async () => {
    setGuestLoading(true);
    try {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      showUserSuccess('Signed in as guest');
      router.push(next);
      router.refresh();
    } catch {
      showUserError('Guest sign in failed. Please try again.');
    } finally {
      setGuestLoading(false);
    }
  };

  const isLoading = !!oauthLoading || emailLoading || guestLoading;

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-2 text-muted-foreground">
          Sign in to submit reports, save your rig, and join the community.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-xl">Sign in to RunDB</CardTitle>
          <CardDescription>
            Use your favorite provider or email to continue
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Social OAuth */}
          <div className="space-y-3">
            <Button
              onClick={() => handleOAuthSignIn('google')}
              disabled={isLoading}
              className="w-full h-11 justify-start pl-5 gap-3"
              variant="outline"
            >
              {oauthLoading === 'google' ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <GoogleIcon />
              )}
              <span>Continue with Google</span>
            </Button>

            <Button
              onClick={() => handleOAuthSignIn('discord')}
              disabled={isLoading}
              className="w-full h-11 justify-start pl-5 gap-3"
              variant="outline"
            >
              {oauthLoading === 'discord' ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <DiscordIcon />
              )}
              <span>Continue with Discord</span>
            </Button>
          </div>

          {/* Privacy tools note: the play.google.com/log ERR_BLOCKED_BY_CLIENT noise some users see
              during Google OAuth is harmless telemetry from Google's consent page (blocked by uBO etc.).
              The redirect flow loads zero Google scripts until the button is clicked. */}
          <p className="text-[11px] text-muted-foreground/70 pt-0.5">
            Privacy tools (uBlock, Brave, etc.) may block some Google background requests. Sign-in still works.
          </p>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Email + Password form */}
          <form onSubmit={form.handleSubmit(handleEmailSignIn)} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                {...form.register('email')}
                disabled={isLoading}
              />
              {form.formState.errors.email && (
                <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/auth/forgot-password"
                  className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  {...form.register('password')}
                  disabled={isLoading}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {form.formState.errors.password && (
                <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
              )}
            </div>

            <Button 
              type="submit" 
              className="w-full h-11 font-medium bg-white text-black hover:bg-white/90" 
              disabled={isLoading}
            >
              {emailLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign in with email'
              )}
            </Button>
          </form>

          {/* Guest */}
          <div className="pt-2">
            <Button
              onClick={handleGuestSignIn}
              disabled={isLoading}
              variant="outline"
              className="w-full h-11 font-medium border-border bg-background/50 hover:bg-accent/50"
            >
              {guestLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Continue as Guest (no account needed)
            </Button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Guests can submit reports and save a rig locally. Create an account later to sync across devices.
            </p>
          </div>

          {/* Footer links */}
          <div className="pt-4 text-center text-sm">
            <span className="text-muted-foreground">Don&apos;t have an account? </span>
            <Link href="/auth/sign-up" className="font-medium text-primary hover:underline">
              Create one for free
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Benefits */}
      <div className="mt-8 text-center text-xs text-muted-foreground space-y-1">
        <p>✓ Submit and manage real performance reports</p>
        <p>✓ Save your PC rig for the compatibility checker</p>
        <p>✓ Upvote helpful reports and build your reputation</p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-md px-4 py-16 text-center text-muted-foreground">Loading...</div>}>
      <SignInForm />
    </Suspense>
  );
}
