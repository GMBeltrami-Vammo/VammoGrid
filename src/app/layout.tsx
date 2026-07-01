import type { Metadata } from 'next';
import { Inter, Geist_Mono } from 'next/font/google';
import './globals.css';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { SessionProvider } from '@/components/providers/SessionProvider';

// Product track (vammo-design DS): Inter, weights matching Supria's
// Light/Regular/Medium/Bold (300/400/500/700).
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'VammoGrid — Gestão de Estoque',
  description: 'Visibilidade de inventário e sugestões de transferência entre bases Vammo',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Apply the saved/system theme before paint to avoid a flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('vammogrid:theme');var d=t!=='light';document.documentElement.classList.toggle('dark',d);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="h-full bg-background text-foreground">
        <SessionProvider>
          <QueryProvider>{children}</QueryProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
