'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
import { Loader2, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { sanitizePassword } from '@/lib/sanitize';

const resetSchema = z
  .object({
    password: z.string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password is too long')
      .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Must contain at least one number')
      .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character')
      .transform((val) => sanitizePassword(val)),
    confirmPassword: z.string().max(128),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

type ResetValues = z.infer<typeof resetSchema>;

export default function ResetPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const supabase = createClient();

  const form = useForm<ResetValues>({
    resolver: zodResolver(resetSchema) as any,
    defaultValues: { password: '', confirmPassword: '' },
  });

  // Attempt to establish a recovery session from the URL tokens Supabase sends
  useEffect(() => {
    const handleRecoverySession = async () => {
      // Supabase password reset emails usually land with tokens in the URL hash
      const hash = window.location.hash;

      if (hash && (hash.includes('access_token') || hash.includes('type=recovery'))) {
        try {
          // Let Supabase's client pick up the tokens automatically on init for recovery flows
          // We just need to make sure a session exists before showing the form
          const { data: { session } } = await supabase.auth.getSession();

          // If no session yet, the browser client should have processed the hash by now
          if (!session) {
            // Small delay + retry in case of race
            await new Promise((r) => setTimeout(r, 300));
          }
        } catch {
          // Non-fatal — user will see error on submit if context is missing
        }
      }
    };

    handleRecoverySession();
  }, [supabase]);

  const handleReset = async (values: ResetValues) => {
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.updateUser({
        password: values.password,
      });

      if (error) {
        if (error.message.toLowerCase().includes('session')) {
          setError('This reset link is invalid or has expired. Please request a new one.');
        } else {
          throw error;
        }
        return;
      }

      setSuccess(true);
      showUserSuccess('Password updated', 'You can now sign in with your new password.');

      // Give user a moment to read success, then redirect to sign in
      setTimeout(() => {
        router.push('/auth/sign-in');
      }, 2200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update password';
      setError(msg);
      showUserError('Could not update password. The link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Card className="text-center">
          <CardHeader>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle className="text-2xl">Password updated!</CardTitle>
            <CardDescription className="pt-2">
              Redirecting you to sign in...
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Set a new password</CardTitle>
          <CardDescription>
            Choose a strong password for your RunDB account.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {error && (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}{' '}
              <Link href="/auth/forgot-password" className="underline hover:no-underline">
                Request a new reset link
              </Link>
            </div>
          )}

          <form onSubmit={form.handleSubmit(handleReset)} className="space-y-5" noValidate>
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  {...form.register('password')}
                  disabled={loading}
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

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  {...form.register('confirmPassword')}
                  disabled={loading}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {form.formState.errors.confirmPassword && (
                <p className="text-xs text-destructive">{form.formState.errors.confirmPassword.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full h-11" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating password...
                </>
              ) : (
                'Update password'
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            <Link href="/auth/sign-in" className="hover:underline">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
