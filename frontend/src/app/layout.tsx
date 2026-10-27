import type { Metadata, Viewport } from 'next';
import { Noto_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import '@/styles/globals.css';

const noto = Noto_Sans({ subsets: ['latin'], variable: '--font-noto', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Voltix', template: '%s · Voltix' },
  description: 'Control every light, fan and sensor in your home from anywhere.',
  applicationName: 'Voltix',
  appleWebApp: { capable: true, title: 'Voltix', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: { icon: '/brand/icon.svg', apple: '/brand/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#f5f8fd',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={noto.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
