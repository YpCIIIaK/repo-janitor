'use client'

import * as React from 'react'
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from 'next-themes'
import { DEFAULT_THEME, THEME_CLASS_MAP, THEME_IDS } from '@/lib/themes'

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={DEFAULT_THEME}
      enableSystem={false}
      themes={[...THEME_IDS]}
      value={THEME_CLASS_MAP}
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}
