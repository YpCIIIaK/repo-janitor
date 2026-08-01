/**
 * Strip the embed down to the plaque: no page chrome, tight body so the iframe
 * host controls the outer size.
 */
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen w-screen overflow-hidden bg-transparent">{children}</div>
  )
}
