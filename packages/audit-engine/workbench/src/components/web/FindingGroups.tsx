"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Empty, Panel } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";
import { isWebProblem } from "@/lib/webSurface";

export type GroupItem = {
  kind?: "signal" | "report";
  slug: string;
  name: string;
  id: string;
  title: string;
  cls: string;
  severity?: string;
  question?: string;
  href: string;
};

export function FindingGroups({
  items,
  empty,
}: {
  items: GroupItem[];
  empty?: string;
}) {
  const { tr } = useLocale();
  const groups = useMemo(() => {
    const map = new Map<string, { slug: string; name: string; problems: GroupItem[]; noise: GroupItem[] }>();
    for (const x of items) {
      const g = map.get(x.slug) || { slug: x.slug, name: x.name, problems: [], noise: [] };
      if (isWebProblem(x.severity, x.kind)) g.problems.push(x);
      else g.noise.push(x);
      map.set(x.slug, g);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  if (!groups.length) return <Empty>{empty || tr("Пусто.", "Empty.")}</Empty>;

  return (
    <div className="web-site-groups">
      {groups.map((g) => (
        <SiteBlock key={g.slug} group={g} />
      ))}
    </div>
  );
}

function SiteBlock({
  group,
}: {
  group: { slug: string; name: string; problems: GroupItem[]; noise: GroupItem[] };
}) {
  const { tr } = useLocale();
  const [openNoise, setOpenNoise] = useState(false);
  return (
    <Panel
      title={group.name}
      meta={`${group.problems.length} ${tr("проблем", "issues")} · ${group.noise.length} ${tr("сигналов", "signals")}`}
      actions={
        <Link className="btn sm outline" href={`/web/scan?slug=${encodeURIComponent(group.slug)}`}>
          {tr("скан", "scan")}
        </Link>
      }
    >
      {group.problems.length === 0 && group.noise.length === 0 ? <Empty>—</Empty> : null}
      {group.problems.map((x) => (
        <div key={`${x.kind}-${x.id}`} className="card" style={{ marginBottom: 8 }}>
          <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
            <div>
              <b>{x.title}</b>{" "}
              <span className="badge sm">{x.kind === "report" ? tr("отчёт", "report") : x.severity}</span>{" "}
              <span className="snip">{x.cls}</span>
              {x.question ? <p className="snip">{x.question}</p> : null}
            </div>
            <Link className="btn sm primary" href={x.href}>
              {tr("открыть", "open")}
            </Link>
          </div>
        </div>
      ))}
      {group.noise.length ? (
        <div className="web-noise">
          <button className="btn ghost sm" type="button" onClick={() => setOpenNoise((v) => !v)}>
            {openNoise ? tr("скрыть сигналы", "hide signals") : tr("сигналы", "signals")} · {group.noise.length}
          </button>
          {openNoise ? (
            <ul className="web-noise-list">
              {group.noise.map((x) => (
                <li key={`${x.kind}-${x.id}`}>
                  <Link href={x.href}>{x.title}</Link>
                  <span className="snip"> {x.severity || x.cls}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="snip web-noise-one">
              {group.noise.map((x) => x.title).join(" · ")}
            </p>
          )}
        </div>
      ) : null}
    </Panel>
  );
}
