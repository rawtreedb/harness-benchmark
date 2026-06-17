import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RawTree Benchmark',
  description: 'Compare AI coding agents across harnesses, models, and sandboxes — traces in RawTree automatically',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
