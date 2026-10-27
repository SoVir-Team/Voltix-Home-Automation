'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api, errorMessage } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (sent) {
    return (
      <div>
        <h1 className="font-bold text-3xl">Check your email</h1>
        <p className="mt-2 text-muted">
          If an account exists for <strong className="text-ink">{email}</strong>, a reset link is on its way.
          It expires in one hour.
        </p>
        <Link href="/login" className="mt-8 inline-block font-semibold text-brand-600">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
          await api.post('/auth/forgot-password', { email });
          setSent(true);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setLoading(false);
        }
      }}
    >
      <div>
        <h1 className="font-bold text-3xl">Reset your password</h1>
        <p className="mt-1 text-muted">Enter your email and we'll send you a link.</p>
      </div>
      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-danger text-sm">{error}</p>}
      <Field label="Email">
        <Input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={loading}>
        Send reset link
      </Button>
      <p className="text-center text-sm">
        <Link href="/login" className="font-semibold text-brand-600">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
