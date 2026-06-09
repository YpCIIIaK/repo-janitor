import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ServerSync } from '@/components/repo-anti-rot/server-sync'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'Repo Anti-Rot — Code Health & Decay Monitor',
  description: 'Track repository rot over time: dead env vars, unused dependencies, stale branches, TODO debt and secrets in history.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="bg-background">
      <body className="font-sans antialiased">
        <ServerSync />
        {children}
        <Toaster />
      </body>
    </html>
  )
}
