'use client'

import * as React from 'react'
import {
  ThemeProvider as NextThemesProvider,
  useTheme,
  type ThemeProviderProps,
} from 'next-themes'
import { DEFAULT_THEME, THEME_IDS, isDarkTheme } from '@/lib/themes'

/** Keep the `dark` class in sync with the selected colour theme. */
function ThemeModeSync() {
  const { theme } = useTheme()

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", isDarkTheme(theme))
  }, [theme])

  return null
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme={DEFAULT_THEME}
      enableSystem={false}
      themes={[...THEME_IDS]}
      disableTransitionOnChange
      {...props}
    >
      <ThemeModeSync />
      {children}
    </NextThemesProvider>
  )
}
