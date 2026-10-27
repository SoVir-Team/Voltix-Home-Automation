'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api, errorMessage } from '@/lib/api';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (done) {
    return (
      <div>
        <h1 className="font-bold text-3xl">Password changed</h1>
        <p className="mt-2 text-muted">
          For your safety we signed you out everywhere. Sign in with your new password.
        </p>
        <Link href="/login" className="mt-8 inline-block font-semibold text-brand-600">
          Sign in
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
          await api.post('/auth/reset-password', { token, password });
          setDone(true);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setLoading(false);
        }
      }}
    >
      <h1 className="font-bold text-3xl">Choose a new password</h1>
      {!token && (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-danger text-sm">This link is incomplete.</p>
      )}
      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-danger text-sm">{error}</p>}
      <Field label="New password" hint="At least 10 characters.">
        <Input
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!token}>
        Save password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
