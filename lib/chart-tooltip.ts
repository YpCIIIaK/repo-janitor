/**
 * Minimal shape of the props recharts passes to a custom tooltip `content` element.
 * recharts' own `TooltipProps` is heavily generic and awkward to satisfy; our tooltips
 * only ever read these fields, so a narrow local type keeps them `any`-free.
 *
 * `T` is the row's original datum (recharts copies it onto `payload[i].payload`).
 */
export interface ChartTooltipEntry<T = unknown> {
  value?: number
  name?: string
  dataKey?: string | number
  color?: string
  payload?: T
}

export interface ChartTooltipProps<T = unknown> {
  active?: boolean
  label?: string | number
  payload?: ChartTooltipEntry<T>[]
}
