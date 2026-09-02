import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RESTAURANT QR OS — Modern Dining & Kitchen Operating System',
  description: 'Production-ready restaurant operating system with mobile QR menu, real-time KDS, waiter dispatch, and SaaS dashboard.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Restaurant QR OS',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0C0A09',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700;800&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#0C0A09] text-[#FAF5EE] antialiased selection:bg-gold-500/30 selection:text-gold-200">
        {children}
      </body>
    </html>
  );
}
