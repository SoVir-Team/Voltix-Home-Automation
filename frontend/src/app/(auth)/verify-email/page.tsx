'use client';

import { CircleCheck, CircleX } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Spinner } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';

function Verify() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState('');
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    api
      .post('/auth/verify-email', { token })
      .then(() => setState('ok'))
      .catch((err) => {
        setError(errorMessage(err));
        setState('error');
      });
  }, [token]);

  if (state === 'loading') return <Spinner className="size-8 text-brand-500" />;
  return (
    <div>
      {state === 'ok' ? (
        <CircleCheck className="mb-4 size-12 text-success" />
      ) : (
        <CircleX className="mb-4 size-12 text-danger" />
      )}
      <h1 className="font-bold text-3xl">{state === 'ok' ? 'Email confirmed' : 'Link not valid'}</h1>
      <p className="mt-2 text-muted">{state === 'ok' ? 'Your account is ready.' : error}</p>
      <Link href="/" className="mt-8 inline-block font-semibold text-brand-600">
        Continue to Voltix
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
