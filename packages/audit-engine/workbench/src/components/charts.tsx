"use client";

/* Графики: чистый SVG, без библиотек. Палитра — проверенная тёмная
   категориальная (validate_palette.js, поверхность #121315, все проверки PASS).
   Цвет назначается по роли: identity → категориальная, magnitude → одна синяя
   ступенчатая шкала, состояние → статусные цвета (всегда с подписью). */

import * as React from "react";
import { useLocale } from "@/components/LocaleProvider";

/* ── палитра ──────────────────────────────────────────────── */

export const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
/* порядковая синяя шкала (светлое = мало, тёмное = много), на тёмном фоне не темнее 600 */
export const RAMP = ["#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab"];
/* статусы: зарезервированы, никогда не «серия N», всегда рядом с подписью */
export const STATUS: Record<string, string> = {
  Critical: "#d03b3b",
  High: "#ec835a",
  Medium: "#fab219",
  Low: "#3987e5",
  CLEAN: "#0ca30c",
  прочее: "#898781",
};

const INK = "#898781";
const GRID = "#2c2c2a";
const AXIS = "#383835";
const SURFACE = "#121315";

/* ── помощники ────────────────────────────────────────────── */

export const fmtNum = (n: number, locale: "ru" | "en" = "en") =>
  Math.abs(n) >= 1e6
    ? `${(n / 1e6).toLocaleString(locale === "ru" ? "ru-RU" : "en-US", { maximumFractionDigits: 1 })}M`
    : Math.abs(n) >= 1000
      ? `${(n / 1000).toLocaleString(locale === "ru" ? "ru-RU" : "en-US", { maximumFractionDigits: n % 1000 === 0 ? 0 : 1 })}k`
      : (Math.round(n * 10) / 10).toLocaleString(locale === "ru" ? "ru-RU" : "en-US");

export const fmtMoney = (n: number, locale: "ru" | "en" = "en") => `$${fmtNum(n, locale)}`;

function useWidth<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null);
  const [w, setW] = React.useState(720);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceTicks(max: number, count = 4) {
  const step = Math.pow(10, Math.floor(Math.log10(max / count || 1)));
  const err = max / count / step;
  const mult = err >= 7.5 ? 10 : err >= 3 ? 5 : err >= 1.5 ? 2 : 1;
  const s = step * mult;
  const out: number[] = [];
  for (let v = 0; v <= max + s * 0.5; v += s) out.push(Number(v.toFixed(6)));
  return out;
}

/* ── обёртка: заголовок, легенда, переключатель на таблицу ── */

export function Figure({
  title,
  note,
  legend,
  table,
  children,
}: {
  title: string;
  note?: string;
  legend?: { label: string; color: string }[];
  table?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { tr } = useLocale();
  const [asTable, setAsTable] = React.useState(false);
  return (
    <div className="k-panel">
      <div className="k-panel-head">
        <div className="t">
          <h3>{title}</h3>
          {note ? <span className="kit-label">{note}</span> : null}
        </div>
        {table ? (
          <div className="acts">
            <button className="btn ghost xs" onClick={() => setAsTable((v) => !v)}>
              {asTable ? tr("график", "chart") : tr("таблица", "table")}
            </button>
          </div>
        ) : null}
      </div>
      <div className={asTable ? "k-flush" : "k-panel-body"}>
        {asTable ? table : children}
        {!asTable && legend && legend.length > 1 ? (
          <div className="viz-legend">
            {legend.map((l) => (
              <span key={l.label}>
                <i style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Tip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div className="viz-tip" style={{ left: x, top: y }}>
      {children}
    </div>
  );
}

/* ── 1. Ранжированные горизонтальные полосы ───────────────── */

export function BarsH({
  rows,
  colors,
  format = fmtNum,
  height = 26,
}: {
  rows: { label: string; value: number; hint?: string }[];
  colors?: string[];
  format?: (n: number) => string;
  height?: number;
}) {
  const { locale, tr } = useLocale();
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const labelW = Math.min(190, Math.max(110, w * 0.28));
  const valueW = 56;
  const barW = Math.max(40, w - labelW - valueW - 12);
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <div className="viz" ref={ref} style={{ position: "relative" }}>
      {rows.map((r, i) => {
        const width = Math.max(2, (r.value / max) * barW);
        const color = colors?.[i] || SERIES[0];
        return (
          <div
            key={r.label}
            className="viz-row"
            style={{ height }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="viz-cat" style={{ width: labelW }} title={r.label}>
              {r.label}
            </span>
            <svg width={barW} height={height} role="presentation">
              <rect x={0} y={height / 2 - 7} width={width} height={14} rx={4} fill={color} />
            </svg>
            <span className="viz-val" style={{ width: valueW }}>
              {format(r.value)}
            </span>
            {hover === i && r.hint ? (
              <span className="viz-inline-hint">{r.hint}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ── 2. Составные полосы (доли по серьёзности) ────────────── */

export function StackedBarsH({
  rows,
  keys,
  colors,
}: {
  rows: { label: string; parts: Record<string, number> }[];
  keys: string[];
  colors: Record<string, string>;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [tip, setTip] = React.useState<{ x: number; y: number; text: string } | null>(null);
  const labelW = 110;
  const barW = Math.max(60, w - labelW - 60);

  return (
    <div className="viz" ref={ref} style={{ position: "relative" }}>
      {rows.map((r) => {
        const total = keys.reduce((a, k) => a + (r.parts[k] || 0), 0) || 1;
        let x = 0;
        return (
          <div key={r.label} className="viz-row" style={{ height: 34 }}>
            <span className="viz-cat" style={{ width: labelW }}>
              {r.label}
            </span>
            <svg width={barW} height={22} role="presentation">
              {keys.map((k) => {
                const v = r.parts[k] || 0;
                if (!v) return null;
                const width = (v / total) * barW;
                const seg = (
                  <rect
                    key={k}
                    x={x}
                    y={4}
                    width={Math.max(1, width - 2)}
                    height={14}
                    rx={3}
                    fill={colors[k] || INK}
                    onMouseEnter={(e) =>
                      setTip({
                        x: e.nativeEvent.offsetX + labelW,
                        y: 0,
                        text: `${k}: ${v} (${Math.round((v / total) * 100)}%)`,
                      })
                    }
                    onMouseLeave={() => setTip(null)}
                  />
                );
                x += width;
                return seg;
              })}
            </svg>
            <span className="viz-val" style={{ width: 56 }}>
              {total}
            </span>
          </div>
        );
      })}
      {tip ? <Tip x={tip.x} y={tip.y}>{tip.text}</Tip> : null}
    </div>
  );
}

/* ── 3. Диаграмма рассеяния, обе оси логарифмические ──────── */

export type Dot = {
  label: string;
  x: number;
  y: number;
  group: string;
  extra?: string;
};

export function ScatterLog({
  dots,
  groups,
  xLabel,
  yLabel,
  height = 320,
  xFormat,
  yFormat,
  labelFor,
  mark,
}: {
  dots: Dot[];
  groups: { key: string; color: string }[];
  xLabel: string;
  yLabel: string;
  height?: number;
  xFormat?: (n: number) => string;
  yFormat?: (n: number) => string;
  /** подпись у избранных точек: вернуть текст или null */
  labelFor?: (d: Dot, i: number) => string | null;
  /** вертикальная опора со смыслом, например «свободнее этого» */
  mark?: { x: number; label: string };
}) {
  const { locale, tr } = useLocale();
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const formatX = xFormat ?? ((n: number) => fmtNum(n, locale));
  const formatY = yFormat ?? ((n: number) => fmtMoney(n, locale));
  const pad = { t: 14, r: 16, b: 30, l: 54 };
  const iw = Math.max(60, w - pad.l - pad.r);
  const ih = height - pad.t - pad.b;

  const lg = (v: number) => Math.log10(Math.max(1, v));
  const xs = dots.map((d) => lg(d.x));
  const ys = dots.map((d) => lg(d.y));
  /* границы округляем до целых декад, чтобы подписи осей совпадали с краями поля */
  const x0 = 0;
  const x1 = Math.max(Math.ceil(Math.max(...xs, 1)), 1);
  const y0 = Math.floor(Math.min(...ys, 3));
  const y1 = Math.max(Math.ceil(Math.max(...ys, 3)), y0 + 1);
  const px = (v: number) => pad.l + ((lg(v) - x0) / (x1 - x0 || 1)) * iw;
  const py = (v: number) => pad.t + ih - ((lg(v) - y0) / (y1 - y0 || 1)) * ih;

  const decades = (a: number, b: number) => {
    const out: number[] = [];
    for (let e = Math.floor(a); e <= Math.ceil(b); e++) out.push(Math.pow(10, e));
    return out;
  };

  return (
    <div className="viz" ref={ref} style={{ position: "relative" }}>
      <svg width="100%" height={height} role="img" aria-label={tr(`${yLabel} против ${xLabel}`, `${yLabel} versus ${xLabel}`)}>
        {decades(y0, y1).map((t) => (
          <g key={`y${t}`}>
            <line x1={pad.l} x2={pad.l + iw} y1={py(t)} y2={py(t)} stroke={GRID} strokeDasharray="2 4" />
            <text x={pad.l - 8} y={py(t)} textAnchor="end" dominantBaseline="middle" fill={INK} className="viz-tick">
              {formatY(t)}
            </text>
          </g>
        ))}
        {decades(x0, x1).map((t) => (
          <g key={`x${t}`}>
            <line x1={px(t)} x2={px(t)} y1={pad.t} y2={pad.t + ih} stroke={GRID} strokeDasharray="2 4" />
            <text x={px(t)} y={pad.t + ih + 16} textAnchor="middle" fill={INK} className="viz-tick">
              {formatX(t)}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={pad.l + iw} y1={pad.t + ih} y2={pad.t + ih} stroke={AXIS} />

        {mark ? (
          <g>
            <line
              x1={px(mark.x)}
              x2={px(mark.x)}
              y1={pad.t}
              y2={pad.t + ih}
              stroke={INK}
              strokeDasharray="4 4"
            />
            <text x={px(mark.x) + 6} y={pad.t + 12} fill={INK} className="viz-tick">
              {mark.label}
            </text>
          </g>
        ) : null}

        {dots.map((d, i) => {
          const c = groups.find((g) => g.key === d.group)?.color || INK;
          const on = hover === i;
          /* точек бывает две сотни: при густоте марка мельчает, иначе
             соседи сливаются в пятно и график перестаёт что-либо говорить */
          const r0 = dots.length > 120 ? 3.2 : dots.length > 60 ? 3.8 : 4.5;
          return (
            <circle
              key={d.label + i}
              cx={px(d.x)}
              cy={py(d.y)}
              r={on ? 7 : r0}
              fill={c}
              fillOpacity={on ? 1 : 0.72}
              stroke={SURFACE}
              strokeWidth={dots.length > 120 ? 1.5 : 2}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "pointer" }}
            />
          );
        })}

        {/* подписи ТОЛЬКО у названных точек: подписывать всё — это и есть каша */}
        {dots.map((d, i) => {
          const text = labelFor?.(d, i);
          if (!text) return null;
          const right = px(d.x) < pad.l + iw * 0.72;
          return (
            <text
              key={`lbl${i}`}
              x={px(d.x) + (right ? 9 : -9)}
              y={py(d.y) + 4}
              textAnchor={right ? "start" : "end"}
              fill={INK}
              className="viz-tick"
            >
              {text}
            </text>
          );
        })}
      </svg>
      <div className="viz-axis-note">
        <span>↑ {yLabel}</span>
        <span>{xLabel} →</span>
      </div>
      {hover !== null ? (
        <Tip x={Math.min(px(dots[hover].x) + 12, Math.max(0, w - 230))} y={py(dots[hover].y) - 8}>
          <b>{dots[hover].label}</b>
          <br />
          {yLabel}: {formatY(dots[hover].y)} · {xLabel}: {formatX(dots[hover].x)}
          {dots[hover].extra ? (
            <>
              <br />
              {dots[hover].extra}
            </>
          ) : null}
        </Tip>
      ) : null}
    </div>
  );
}

/* ── 4. Нарастающий итог по времени ───────────────────────── */

export function StepArea({
  labels,
  series,
  height = 220,
}: {
  labels: string[];
  series: { name: string; color: string; data: number[] }[];
  height?: number;
}) {
  const { locale, tr } = useLocale();
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const pad = { t: 14, r: 62, b: 28, l: 40 };
  const iw = Math.max(40, w - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const ticks = niceTicks(Math.max(...series.flatMap((s) => s.data), 1));
  const max = ticks[ticks.length - 1];
  const x = (i: number) => pad.l + (iw * i) / Math.max(1, labels.length - 1);
  const y = (v: number) => pad.t + ih - (v / max) * ih;

  const step = (data: number[]) =>
    data
      .map((v, i) => (i === 0 ? `M ${x(i)} ${y(v)}` : `L ${x(i)} ${y(data[i - 1])} L ${x(i)} ${y(v)}`))
      .join(" ");

  return (
    <div
      className="viz"
      ref={ref}
      style={{ position: "relative" }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const i = Math.round(((e.clientX - r.left - pad.l) / iw) * (labels.length - 1));
        setHover(Math.max(0, Math.min(labels.length - 1, i)));
      }}
      onMouseLeave={() => setHover(null)}
    >
      <svg width="100%" height={height} role="img" aria-label={tr("Нарастающий итог", "Cumulative total")}>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.l}
              x2={pad.l + iw}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? AXIS : GRID}
              strokeDasharray={t === 0 ? undefined : "2 4"}
            />
            <text x={pad.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fill={INK} className="viz-tick">
              {fmtNum(t, locale)}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.name}>
            <path d={step(s.data)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
            <text
              x={x(labels.length - 1) + 8}
              y={y(s.data[s.data.length - 1])}
              dominantBaseline="middle"
              fill={s.color}
              className="viz-tick"
            >
              {s.name} {s.data[s.data.length - 1]}
            </text>
          </g>
        ))}
        {hover !== null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke={AXIS} />
            {series.map((s) => (
              <circle
                key={s.name}
                cx={x(hover)}
                cy={y(s.data[hover])}
                r={4}
                fill={s.color}
                stroke={SURFACE}
                strokeWidth={2}
              />
            ))}
          </g>
        ) : null}
        {labels.map((l, i) =>
          i % Math.ceil(labels.length / 6) === 0 ? (
            <text key={l} x={x(i)} y={pad.t + ih + 18} textAnchor="middle" fill={INK} className="viz-tick">
              {l}
            </text>
          ) : null
        )}
      </svg>
      {hover !== null ? (
        <Tip x={Math.min(x(hover) + 10, Math.max(0, w - 190))} y={4}>
          <b>{labels[hover]}</b>
          {series.map((s) => (
            <span key={s.name}>
              <br />
              <i className="viz-swatch" style={{ background: s.color }} /> {s.name}: {s.data[hover]}
            </span>
          ))}
        </Tip>
      ) : null}
    </div>
  );
}
