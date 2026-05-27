'use client';

import { useState } from 'react';
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
import { Loader2, ArrowLeft, MailCheck } from 'lucide-react';
import { sanitizeEmail } from '@/lib/sanitize';

const forgotSchema = z.object({
  email: z.string()
    .trim()
    .min(5, 'Please enter your email address')
    .max(254, 'Email address is too long')
    .email('Please enter a valid email address')
    .transform((val) => sanitizeEmail(val)),
});

type ForgotValues = z.infer<typeof forgotSchema>;

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState('');

  const supabase = createClient();

  const form = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema) as any,
    defaultValues: { email: '' },
  });

  const handleResetRequest = async (values: ForgotValues) => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });

      if (error) throw error;

      setSubmittedEmail(values.email);
      setSubmitted(true);
      showUserSuccess('Reset link sent', 'Check your inbox for password reset instructions.');
    } catch (error) {
      showUserError('Could not send reset link. Please try again in a moment.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Card className="text-center">
          <CardHeader>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
              <MailCheck className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <CardTitle className="text-2xl">Check your email</CardTitle>
            <CardDescription className="pt-2">
              We sent password reset instructions to{' '}
              <span className="font-medium text-foreground">{submittedEmail}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The link will expire after a short time. If you don&apos;t see the email, check your spam folder.
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <Button asChild variant="outline">
                <Link href="/auth/sign-in">Back to sign in</Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="hover:bg-accent/70"
                onClick={() => {
                  setSubmitted(false);
                  setSubmittedEmail('');
                  form.reset();
                }}
              >
                Try a different email
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <div className="mb-6">
        <Link
          href="/auth/sign-in"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to sign in
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Forgot your password?</CardTitle>
          <CardDescription>
            Enter your email and we&apos;ll send you a link to reset your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(handleResetRequest)} className="space-y-5" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                {...form.register('email')}
                disabled={loading}
              />
              {form.formState.errors.email && (
                <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full h-11" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending reset link...
                </>
              ) : (
                'Send reset link'
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Remembered your password?{' '}
            <Link href="/auth/sign-in" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
