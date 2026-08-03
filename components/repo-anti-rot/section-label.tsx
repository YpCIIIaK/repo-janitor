/**
 * The numbered eyebrow above each landing section.
 *
 * The index is decoration, not navigation — it gives a reader scanning the page
 * a sense of how far through they are without pretending to be a table of
 * contents you can click. Kept as a component so the five sections cannot drift
 * apart in weight or spacing.
 */
export function SectionLabel({ index, children }: { index: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
      <span className="text-primary">{index}</span>
      <span aria-hidden className="h-px w-6 bg-border" />
      {children}
    </p>
  )
}
