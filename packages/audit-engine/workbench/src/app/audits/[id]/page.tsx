"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Empty, Status } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";

export default function AuditView() {
  const { tr } = useLocale();
  const { id } = useParams<{ id: string }>();
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    fetch(`/api/audits/${id}`)
      .then((r) => r.json())
      .then(setRow);
  }, [id]);
  if (!row)
    return (
      <Empty>
        <Status tone="accent" pulse>
          {tr("загрузка", "loading")}
        </Status>
      </Empty>
    );
  return (
    <>
      <div className="top">
        <div>
          <h1>{String(row.title)}</h1>
          <p className="sub mono">
            {String(row.source_path)} · {String(row.kind)}
          </p>
        </div>
      </div>
      <div className="k-code-wrap">
        <pre style={{ maxHeight: "72vh" }}>{String(row.body)}</pre>
      </div>
    </>
  );
}
