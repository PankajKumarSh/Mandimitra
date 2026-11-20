import type { Metadata, Viewport } from 'next';
import { Inter, Noto_Sans_Devanagari } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const devanagari = Noto_Sans_Devanagari({ subsets: ['devanagari'], weight: ['400', '500', '600', '700'], variable: '--font-devanagari', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'मंडीमित्र — MandiMitra', template: '%s · मंडीमित्र' },
  description: 'आढ़ती का पूरा हिसाब, एक ही जगह।',
};

export const viewport: Viewport = { themeColor: '#166534', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="hi" className={`${inter.variable} ${devanagari.variable}`}>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
