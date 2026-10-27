'use client';

import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api, errorMessage } from '@/lib/api';
import { safeNext } from '@/lib/format';

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  if (checkEmail) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl bg-brand-50 text-brand-500">
          <MailCheck className="size-8" />
        </div>
        <h1 className="font-bold text-2xl">Check your email</h1>
        <p className="mt-2 text-muted">
          We sent a confirmation link to <strong className="text-ink">{form.email}</strong>. Open it to finish
          setting up your account.
        </p>
        <Link href="/login" className="mt-8 inline-block font-semibold text-brand-600">
          Back to sign in
        </Link>
      </div>
    );
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
          const res = await api.post<{ verificationRequired?: boolean }>('/auth/register', form);
          if (res.verificationRequired) return setCheckEmail(true);
          router.replace(safeNext(params.get('next')));
          router.refresh();
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setLoading(false);
        }
      }}
    >
      <div>
        <h1 className="font-bold text-3xl">Create your account</h1>
        <p className="mt-1 text-muted">We'll set up your first home with a few rooms.</p>
      </div>
      {error && (
        <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-danger text-sm">
          {error}
        </p>
      )}
      <Field label="Your name">
        <Input autoComplete="name" required maxLength={80} value={form.name} onChange={set('name')} />
      </Field>
      <Field label="Email">
        <Input type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
      </Field>
      <Field label="Password" hint="At least 10 characters. A short phrase is easiest to remember.">
        <Input
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={form.password}
          onChange={set('password')}
        />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={loading}>
        Create account
      </Button>
      <p className="text-center text-muted text-sm">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-brand-600">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
