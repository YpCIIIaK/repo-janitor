import { randomBytes } from "node:crypto";

/** Маркер без спецсимволов: не XSS, не SQLi, не HTML. */
export function makeCanary() {
  return "asct" + randomBytes(6).toString("hex");
}

export function isSafeParamName(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_.-]{0,40}$/.test(name);
}

export function isCanary(value: string) {
  return /^asct[a-f0-9]{12}$/.test(value) || /^[A-Za-z0-9_-]{8,48}$/.test(value);
}

export type Reflection = {
  reflected: boolean;
  count: number;
  where: "none" | "text" | "attribute" | "script" | "json" | "header" | "url";
  snippet: string;
};

function contextAt(body: string, i: number): Reflection["where"] {
  const before = body.slice(Math.max(0, i - 200), i).toLowerCase();
  if (/<script[^>]*>[^<]*$/.test(before)) return "script";
  if (/\s[a-z0-9:-]+=["'][^"']*$/.test(before)) return "attribute";
  const trimmed = body.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  return "text";
}

export function findCanary(canary: string, body: string, headers: Record<string, string>, finalUrl: string): Reflection {
  const hay = stripSelfUrls(body, finalUrl);
  let count = 0;
  let first = -1;
  let from = 0;
  while (true) {
    const i = hay.indexOf(canary, from);
    if (i < 0) break;
    if (first < 0) first = i;
    count++;
    from = i + canary.length;
    if (count > 20) break;
  }
  if (first >= 0) {
    const snippet = hay.slice(Math.max(0, first - 40), first + canary.length + 40).replace(/\s+/g, " ");
    return { reflected: true, count, where: contextAt(hay, first), snippet };
  }

  const headerHit = Object.entries(headers).find(([k, v]) => k !== "location" && v.includes(canary));
  if (headerHit) {
    return { reflected: true, count: 1, where: "header", snippet: `${headerHit[0]}: ${headerHit[1].slice(0, 160)}` };
  }

  if (canaryInUrlBeyondQuery(canary, finalUrl)) {
    return { reflected: true, count: 1, where: "url", snippet: finalUrl.slice(0, 200) };
  }

  return { reflected: false, count: 0, where: "none", snippet: "" };
}

/** Query, который мы сами поставили, — не отражение. WordPress часто копирует его в action формы. */
function stripSelfUrls(body: string, finalUrl: string) {
  let b = body;
  try {
    const u = new URL(finalUrl);
    const bits = [finalUrl, u.pathname + u.search, u.search];
    if (u.search.length > 1) bits.push(u.search.slice(1));
    for (const v of bits) {
      if (v.length < 6) continue;
      b = b.split(v).join("");
      try {
        b = b.split(encodeURI(v)).join("");
      } catch {
        /* skip */
      }
    }
  } catch {
    /* keep body */
  }
  return b;
}

function canaryInUrlBeyondQuery(canary: string, finalUrl: string) {
  try {
    const u = new URL(finalUrl);
    if (u.hostname.includes(canary) || u.pathname.includes(canary) || u.hash.includes(canary)) return true;
    return false;
  } catch {
    return false;
  }
}

export function checkVerdict(r: Reflection) {
  if (!r.reflected) {
    return {
      valid: false as const,
      label: "не отразилось",
      next: "Маркер не попал в тело ответа. То, что он есть в ?q=… — нормально, это не дыра. Нужен другой параметр или страница, где поиск печатает запрос в HTML.",
    };
  }
  if (r.where === "script") {
    return {
      valid: true as const,
      label: "маркер в script",
      next: "Отражение в JS без полезной нагрузки. В отчёте: контекст script, свой маркер, скрин/фрагмент. XSS-payload не слать.",
    };
  }
  if (r.where === "attribute") {
    return {
      valid: true as const,
      label: "маркер в атрибуте",
      next: "Достаточно факта отражения. Не закрывать кавычки и не слать обработчики.",
    };
  }
  if (r.where === "url") {
    return {
      valid: false as const,
      label: "только в пути URL",
      next: "Маркер в pathname, не в HTML. Это ещё не XSS. Не отчёт, пока нет куска тела страницы.",
    };
  }
  if (r.where === "json") {
    return {
      valid: true as const,
      label: "маркер в JSON",
      next: "Зафиксировать путь поля. Не подставлять JSON-breakers.",
    };
  }
  return {
    valid: true as const,
    label: "маркер в ответе",
    next: "Находка по отражению безопасной строки. Для отчёта хватает маркера, URL и фрагмента.",
  };
}

export function draftReport(input: {
  program: string;
  programUrl?: string;
  title: string;
  cls: string;
  url: string;
  param: string;
  canary: string;
  status: number;
  reflection: Reflection;
  verdict: string;
  extra?: string;
}) {
  return `# ${input.title}

**Program:** ${input.program}${input.programUrl ? ` (${input.programUrl})` : ""}
**Class:** ${input.cls}
**Asset:** ${input.url}

## Summary
Unharmful canary \`${input.canary}\` sent in parameter \`${input.param}\` came back in the response (${input.reflection.where}, ${input.reflection.count}×). HTTP ${input.status}. ${input.verdict}

## Steps to reproduce
1. Authenticate with **your own** in-scope test account only.
2. Send a GET or form POST with \`${input.param}=${input.canary}\` (alphanumeric marker, no script, no SQL).
3. Observe the marker in the response fragment below.

## Evidence
\`\`\`
${input.reflection.snippet || "(no snippet)"}
\`\`\`

## Impact
Depends on encoding and authz around this field. This report does **not** include an exploit payload. If the marker lands unescaped in HTML/JS, stored/reflected XSS is plausible; if it lands in a query that errors, that is a signal to review on **staging**, still without injection payloads.

## Suggested fix
Encode/parameterize on output/input. Reject unexpected types. Add regression test that this marker does not appear raw in HTML/JS.

## Policy
No production damage, no other users’ data, no public PoC. Submit only via the program portal.

${input.extra || ""}
`;
}

export function draftSurfaceReport(input: {
  program: string;
  programUrl?: string;
  title: string;
  cls: string;
  url: string;
  question: string;
  evidence: string;
  severity?: string;
}) {
  return `# ${input.title}

**Program:** ${input.program}${input.programUrl ? ` (${input.programUrl})` : ""}
**Class:** ${input.cls}
**Severity (signal):** ${input.severity || "n/a"}
**Asset:** ${input.url}

## Summary
${input.question}

## Evidence
\`\`\`
${input.evidence || "(none)"}
\`\`\`

## Steps
1. Open the in-scope URL with your own test account.
2. Inspect the response (headers/body). No exploit payload.
3. Confirm the evidence still matches.

## Suggested fix
Harden the control named in the summary (headers, cookie flags, encoding, access checks). Add a regression test.

## Policy
Submit only via the program portal. No production damage, no other users’ data, no public exploit.
`;
}
