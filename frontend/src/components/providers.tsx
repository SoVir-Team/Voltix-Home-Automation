'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            // Don't hammer the API on 4xx (permissions, not found); retry network/5xx twice.
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster
        position="top-center"
        richColors
        closeButton
        toastOptions={{ style: { borderRadius: '1.25rem' } }}
        offset={{ top: 'max(16px, env(safe-area-inset-top))' }}
      />
    </QueryClientProvider>
  );
}
