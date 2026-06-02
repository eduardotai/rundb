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

import { toast } from 'sonner';
import { showUserError, showUserSuccess } from '@/lib/toast';
import { Eye, EyeOff, Loader2, CheckCircle2 } from 'lucide-react';
import { sanitizeEmail, sanitizePassword, sanitizeFullName } from '@/lib/sanitize';
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

const signUpSchema = z
  .object({
    fullName: z.string()
      .trim()
      .min(2, 'Please enter your full name')
      .max(80, 'Name is too long')
      .regex(/^[\p{L}\p{M}\s\-'.]+$/u, 'Name contains invalid characters')
      .transform((val) => sanitizeFullName(val)),
    email: z.string()
      .trim()
      .min(5, 'Please enter your email address')
      .max(254, 'Email address is too long')
      .email('Please enter a valid email address')
      .transform((val) => sanitizeEmail(val)),
    password: z.string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password is too long')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number')
      .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character')
      .transform((val) => sanitizePassword(val)),
    confirmPassword: z.string()
      .max(128),
    acceptTerms: z.boolean().refine((val) => val === true, {
      message: 'You must accept the Terms and Privacy Policy',
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  })
  // Extra: after transforms, make sure name is still valid
  .refine((data) => data.fullName.length >= 2, {
    message: 'Please enter a valid name',
    path: ['fullName'],
  });

type SignUpValues = z.infer<typeof signUpSchema>;

function SignUpForm() {
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const next = getSafeAuthRedirectPath(searchParams.get('next'));

  const supabase = createClient();

  const form = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema) as any,
    defaultValues: {
      fullName: '',
      email: '',
      password: '',
      confirmPassword: '',
      acceptTerms: false,
    },
  });

  // Redirect if already logged in
  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        router.replace(next);
      }
    };
    checkUser();
  }, [router, next, supabase]);

  const handleOAuthSignUp = async (provider: 'google' | 'discord') => {
    setOauthLoading(provider);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) throw error;
    } catch (error) {
      showUserError('Could not sign up with Google. Please try again.');
      setOauthLoading(null);
    }
  };

  const handleEmailSignUp = async (values: SignUpValues) => {
    setEmailLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
        options: {
          data: {
            full_name: values.fullName,
          },
        },
      });

      if (error) {
        if (error.message.includes('already registered')) {
          showUserError('An account with this email already exists. Try signing in instead.');
        } else {
          throw error;
        }
        return;
      }

      if (data.session) {
        showUserSuccess('Account created!');
        router.push(next);
      } else {
        setSignupSuccess(true);
        showUserSuccess('Check your email', 'We sent a confirmation link. Click it to activate your account.');
      }
    } catch (error) {
      showUserError('Sign up failed. Please try again in a moment.');
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
    } catch (error) {
      showUserError('Guest sign in failed. Please try again.');
    } finally {
      setGuestLoading(false);
    }
  };

  const isLoading = !!oauthLoading || emailLoading || guestLoading;

  // Success state after email sign up (awaiting confirmation)
  if (signupSuccess) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
        <Card className="text-center">
          <CardHeader>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle className="text-2xl">Check your inbox</CardTitle>
            <CardDescription className="pt-2 text-base">
              We sent a confirmation link to <span className="font-medium text-foreground">{form.getValues('email')}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Click the link in the email to activate your account. You can close this page.
            </p>
            <div className="pt-2">
              <Button asChild variant="outline" className="w-full">
                <Link href="/auth/sign-in">Back to sign in</Link>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Didn&apos;t receive it? Check spam or try signing up again in a few minutes.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-2 text-muted-foreground">
          Join the community of gamers sharing real PC performance data.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-xl">Sign up for RunDB</CardTitle>
          <CardDescription>
            Free forever. No credit card required.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Social OAuth */}
          <div className="space-y-3">
            <Button
              onClick={() => handleOAuthSignUp('google')}
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
              onClick={() => handleOAuthSignUp('discord')}
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
            Privacy tools (uBlock, Brave, etc.) may block some Google background requests. Sign-up still works.
          </p>

          {/* Email signup form */}
          <form onSubmit={form.handleSubmit(handleEmailSignUp)} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="fullName">Full name</Label>
              <Input
                id="fullName"
                placeholder="Alex Rivera"
                autoComplete="name"
                {...form.register('fullName')}
                disabled={isLoading}
              />
              {form.formState.errors.fullName && (
                <p className="text-xs text-destructive">{form.formState.errors.fullName.message}</p>
              )}
            </div>

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
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Create a strong password"
                  autoComplete="new-password"
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
              <p className="text-[10px] text-muted-foreground">At least 8 characters, 1 uppercase, 1 number</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Repeat your password"
                  autoComplete="new-password"
                  {...form.register('confirmPassword')}
                  disabled={isLoading}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {form.formState.errors.confirmPassword && (
                <p className="text-xs text-destructive">{form.formState.errors.confirmPassword.message}</p>
              )}
            </div>

            <div className="flex items-start gap-2 pt-1">
              <input
                id="acceptTerms"
                type="checkbox"
                checked={form.watch('acceptTerms')}
                onChange={(e) => form.setValue('acceptTerms', e.target.checked)}
                disabled={isLoading}
                className="mt-0.5 h-4 w-4 accent-primary border-border rounded focus:ring-1 focus:ring-primary/20"
              />
              <Label htmlFor="acceptTerms" className="text-xs leading-snug text-muted-foreground cursor-pointer select-none">
                I agree to the{' '}
                <a href="#" className="text-foreground hover:underline">Terms of Service</a> and{' '}
                <a href="#" className="text-foreground hover:underline">Privacy Policy</a>.
              </Label>
            </div>
            {form.formState.errors.acceptTerms && (
              <p className="text-xs text-destructive -mt-3">{form.formState.errors.acceptTerms.message}</p>
            )}

            <Button 
              type="submit" 
              className="w-full h-11 mt-2 font-medium bg-white text-black hover:bg-white/90" 
              disabled={isLoading}
            >
              {emailLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                'Create account'
              )}
            </Button>
          </form>

          {/* Guest option */}
          <div>
            <Button
              onClick={handleGuestSignIn}
              disabled={isLoading}
              variant="outline"
              className="w-full h-11 font-medium border-border bg-background/50 hover:bg-accent/50"
            >
              {guestLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Continue as Guest instead
            </Button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              You can create a permanent account later to keep your data across devices.
            </p>
          </div>

          <div className="pt-2 text-center text-sm">
            <span className="text-muted-foreground">Already have an account? </span>
            <Link href="/auth/sign-in" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="mt-8 text-center text-xs text-muted-foreground">
        Your data is protected with industry-standard encryption. We will never sell your information.
      </div>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-md px-4 py-16 text-center text-muted-foreground">Loading...</div>}>
      <SignUpForm />
    </Suspense>
  );
}

