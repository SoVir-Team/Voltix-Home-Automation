'use client';

import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, ButtonLink } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';

interface InviteInfo {
  email: string;
  role: string;
  homeName: string;
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<{ invite: InviteInfo }>(`/invites/${token}`).then((r) => r.invite),
    retry: false,
  });
  // Are we signed in? (No redirect on 401 for public pages: /auth paths skip the retry, /me is cheap.)
  const signedIn = typeof document !== 'undefined' && document.cookie.includes('vx_session=');

  if (invite.isPending) return <Spinner className="size-8 text-brand-500" />;
  if (invite.isError)
    return (
      <div>
        <h1 className="font-bold text-3xl">Invite not valid</h1>
        <p className="mt-2 text-muted">It may have expired or already been used. Ask for a new invite.</p>
      </div>
    );

  const next = encodeURIComponent(`/invite/${token}`);
  return (
    <div>
      <div className="mb-6 grid size-16 place-items-center rounded-2xl bg-brand-50 text-brand-500">
        <Users className="size-8" />
      </div>
      <h1 className="font-bold text-3xl">Join {invite.data.homeName}</h1>
      <p className="mt-2 text-muted">
        You've been invited as <strong className="text-ink">{invite.data.role}</strong>. This invite is for{' '}
        <strong className="text-ink">{invite.data.email}</strong>.
      </p>
      {error && <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-danger text-sm">{error}</p>}
      <div className="mt-8 flex flex-col gap-3">
        {signedIn ? (
          <Button
            size="lg"
            loading={joining}
            onClick={async () => {
              setJoining(true);
              setError('');
              try {
                const { homeId } = await api.post<{ homeId: string }>('/invites/accept', { token });
                localStorage.setItem('voltix.home', homeId);
                router.replace('/');
              } catch (err) {
                setError(errorMessage(err));
                setJoining(false);
              }
            }}
          >
            Accept invite
          </Button>
        ) : (
          <>
            <ButtonLink href={`/register?next=${next}`} size="lg">
              Create account
            </ButtonLink>
            <ButtonLink href={`/login?next=${next}`} size="lg" variant="outline">
              I already have an account
            </ButtonLink>
          </>
        )}
      </div>
    </div>
  );
}
