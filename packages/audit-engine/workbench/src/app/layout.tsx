import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { LocaleProvider } from "@/components/LocaleProvider";
import { HuntModeProvider } from "@/components/HuntModeProvider";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { isHuntTrack, TRACK_COOKIE } from "@/lib/huntTrack";

export const metadata: Metadata = {
  title: "auditscout workbench",
  description: "Локальный стол для охоты за баунти",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const savedLocale = jar.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(savedLocale) ? savedLocale : DEFAULT_LOCALE;
  const savedTrack = jar.get(TRACK_COOKIE)?.value;
  const track = isHuntTrack(savedTrack) ? savedTrack : "web3";
  return (
    <html lang={locale} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <LocaleProvider initialLocale={locale}>
          <HuntModeProvider initialTrack={track}>
            <Shell>{children}</Shell>
          </HuntModeProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
