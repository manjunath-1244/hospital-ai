import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '../context/AuthContext';
import { RoleProvider } from '../context/RoleContext';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  title: 'MK — Clinical Operations',
  description: 'Hospital operations portals backed by the MK API (Mastra AI, NestJS, FHIR, DICOM).',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="antialiased min-h-screen bg-canvas text-ink">
        <AuthProvider>
          <RoleProvider>{children}</RoleProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
