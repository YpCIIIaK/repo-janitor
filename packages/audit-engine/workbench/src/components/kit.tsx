/* Компоненты из minimalist-ui-library (GRAPHITE), перенесённые на CSS проекта.
   Только оформление — ни запросов, ни состояния приложения здесь нет. */

import * as React from "react";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const cx = (...v: (string | false | undefined)[]) => v.filter(Boolean).join(" ");

/* ── панель ───────────────────────────────────────────────── */

export function Panel({
  title,
  meta,
  actions,
  footer,
  flush,
  className,
  children,
}: {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  flush?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cx("k-panel", className)}>
      {title !== undefined ? (
        <div className="k-panel-head">
          <div className="t">
            <h3>{title}</h3>
            {meta ? <span className="kit-label">{meta}</span> : null}
          </div>
          {actions ? <div className="acts">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cx("k-panel-body", flush && "k-flush")}>{children}</div>
      {footer ? <div className="k-panel-foot">{footer}</div> : null}
    </div>
  );
}

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  if (htmlFor) return <label htmlFor={htmlFor} className="k-label kit-label">{children}</label>;
  return <span className="k-label kit-label">{children}</span>;
}

export function Divider({ label }: { label?: string }) {
  if (!label) return <hr />;
  return (
    <div className="k-divider">
      <span className="kit-label">{label}</span>
    </div>
  );
}

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("k-toolbar", className)}>{children}</div>;
}

/* ── показатели ───────────────────────────────────────────── */

export function Stat({
  label,
  value,
  hint,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="card k-stat">
      <span className="l kit-label">{label}</span>
      <span className="n tabular">{value}</span>
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

/* ── метки и состояния ────────────────────────────────────── */

export function Badge({
  tone,
  sm,
  children,
  className,
}: {
  tone?: Tone;
  sm?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={cx("k-badge", tone, sm && "sm", className)}>{children}</span>;
}

export function StatusDot({ tone = "neutral", pulse }: { tone?: Tone; pulse?: boolean }) {
  return (
    <span className={cx("k-dot", tone, pulse && "pulse")} aria-hidden="true">
      <i />
    </span>
  );
}

export function Status({
  tone = "neutral",
  pulse,
  children,
}: {
  tone?: Tone;
  pulse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className="k-status">
      <StatusDot tone={tone} pulse={pulse} />
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="k-kbd">{children}</kbd>;
}

export function Callout({
  tone = "neutral",
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cx("k-callout", tone !== "neutral" && tone)}>
      <span className="bar" aria-hidden />
      <div className="b">
        {title ? <div className="t">{title}</div> : null}
        {children}
      </div>
    </div>
  );
}

/** Каркас загрузки: держит место под будущие плитки и график. */
export function Skeleton({ tiles = 5, chart = true }: { tiles?: number; chart?: boolean }) {
  return (
    <>
      <div className="grid stats">
        {Array.from({ length: tiles }).map((_, i) => (
          <div key={i} className="skel tile" />
        ))}
      </div>
      {chart ? (
        <div className="grid" style={{ gap: 12 }}>
          <div className="k-panel">
            <div className="k-panel-body">
              <div className="skel chart" />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="k-empty">{children}</div>;
}

/* ── кнопки ───────────────────────────────────────────────── */

export function Spinner() {
  return (
    <svg className="k-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function ButtonGroup({ children }: { children: React.ReactNode }) {
  return <div className="k-group" role="group">{children}</div>;
}
