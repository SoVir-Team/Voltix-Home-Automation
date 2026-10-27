'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api, errorMessage } from '@/lib/api';
import { safeNext } from '@/lib/format';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
          await api.post('/auth/login', { email, password });
          router.replace(safeNext(params.get('next')));
          router.refresh();
        } catch (err) {
          setError(errorMessage(err));
          setLoading(false);
        }
      }}
      className="space-y-5"
    >
      <div>
        <h1 className="font-bold text-3xl">Welcome back</h1>
        <p className="mt-1 text-muted">Sign in to control your home.</p>
      </div>
      {error && (
        <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-danger text-sm">
          {error}
        </p>
      )}
      <Field label="Email">
        <Input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Password">
        <Input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <div className="flex justify-end">
        <Link href="/forgot-password" className="font-medium text-brand-600 text-sm">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" size="lg" className="w-full" loading={loading}>
        Sign in
      </Button>
      <p className="text-center text-muted text-sm">
        New to Voltix?{' '}
        <Link
          href={`/register${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`}
          className="font-semibold text-brand-600"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
