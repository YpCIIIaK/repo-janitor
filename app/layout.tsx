import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { cookies, headers } from 'next/headers'
import { ServerSync } from '@/components/repo-anti-rot/server-sync'
import { LocaleProvider } from '@/components/i18n/locale-provider'
import { Toaster } from '@/components/ui/sonner'
import { LOCALE_COOKIE, resolveLocale } from '@/lib/i18n'
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Resolved on the server so the first paint is already in the reader's
  // language: a shared link opened cold must not flash English and then swap.
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()])
  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerList.get("accept-language"),
  )

  return (
    <html lang={locale} className="bg-background">
      <body className="font-sans antialiased">
        <LocaleProvider initial={locale}>
          <ServerSync />
          {children}
          <Toaster />
        </LocaleProvider>
      </body>
    </html>
  )
}
