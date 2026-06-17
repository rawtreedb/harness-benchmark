import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Harness Benchmark',
  description: 'Compare AI coding agents across harnesses, models, and sandboxes',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
