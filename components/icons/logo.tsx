/**
 * Brand mark: square brackets with an orange sweep. Brackets and tile follow
 * the current theme (currentColor / theme tokens); the sweep stays brand orange.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true">
      <rect x="2" y="2" width="116" height="116" rx="26" fill="var(--secondary)" stroke="var(--border)" strokeWidth="4" />
      <path
        d="M42 30H32v60h10M78 30h10v60H78"
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M50 74l20-28" fill="none" stroke="#f97316" strokeWidth="8" strokeLinecap="round" />
    </svg>
  )
}
