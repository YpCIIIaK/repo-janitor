export type WebFinding = {
  id: string;
  cls: string;
  severity: "info" | "low" | "medium" | "high";
  title: string;
  question: string;
  evidence: string;
};

/** medium/high — разворачиваем. info/low — строка в списке, не «дыра». */
export function isWebProblem(severity?: string, kind?: string) {
  if (kind === "report") return true;
  return severity === "high" || severity === "medium";
}

function hget(headers: Record<string, string>, name: string) {
  return headers[name.toLowerCase()] || "";
}

function cookieFlags(setCookie: string) {
  const parts = setCookie.split(/,(?=\s*[^;]+=)/) || [setCookie];
  const out: WebFinding[] = [];
  for (const raw of parts) {
    const c = raw.trim();
    if (!c || !c.includes("=")) continue;
    const name = c.split("=")[0].trim();
    const low = c.toLowerCase();
    if (!low.includes("httponly")) {
      out.push({
        id: `cookie-httponly-${name}`,
        cls: "cookies",
        severity: "medium",
        title: `Cookie ${name} без HttpOnly`,
        question: "Доступен ли этот cookie скрипту на странице, и есть ли XSS, который его прочитает?",
        evidence: c.slice(0, 180),
      });
    }
    if (!low.includes("secure")) {
      out.push({
        id: `cookie-secure-${name}`,
        cls: "cookies",
        severity: "medium",
        title: `Cookie ${name} без Secure`,
        question: "Уйдёт ли сессия по http, если HSTS тоже нет?",
        evidence: c.slice(0, 180),
      });
    }
    if (!low.includes("samesite")) {
      out.push({
        id: `cookie-samesite-${name}`,
        cls: "cookies",
        severity: "low",
        title: `Cookie ${name} без SameSite`,
        question: "Идёт ли cookie в cross-site POST и достаточно ли CSRF-токена?",
        evidence: c.slice(0, 180),
      });
    }
  }
  return out;
}

export function analyzeSurface(input: {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}): WebFinding[] {
  const { url, status, headers, body } = input;
  const f: WebFinding[] = [];
  const html = body.slice(0, 350_000);

  f.push({
    id: "status",
    cls: "info",
    severity: "info",
    title: `Ответ ${status}`,
    question: "Ожидаемый ли это код для публичной страницы скоупа?",
    evidence: url,
  });

  const server = hget(headers, "server");
  if (server) {
    f.push({
      id: "server",
      cls: "info",
      severity: "info",
      title: "Заголовок Server",
      question: "Нужна ли эта версия сервера снаружи, или это лишний ориентир для CVE?",
      evidence: server.slice(0, 120),
    });
  }
  const powered = hget(headers, "x-powered-by");
  if (powered) {
    f.push({
      id: "powered",
      cls: "info",
      severity: "low",
      title: "X-Powered-By",
      question: "Стоит ли убрать стек из ответа?",
      evidence: powered.slice(0, 120),
    });
  }

  if (!hget(headers, "strict-transport-security")) {
    f.push({
      id: "hsts",
      cls: "headers",
      severity: "info",
      title: "Нет HSTS",
      question: "Гигиена TLS. Сама по себе находкой для баунти почти не бывает.",
      evidence: "strict-transport-security отсутствует",
    });
  }
  if (!hget(headers, "content-security-policy") && !hget(headers, "content-security-policy-report-only")) {
    f.push({
      id: "csp",
      cls: "headers",
      severity: "info",
      title: "Нет CSP",
      question: "Нет второго слоя против XSS. Без рабочего отражения в HTML это не отчёт.",
      evidence: "content-security-policy отсутствует",
    });
  }
  const csp = hget(headers, "content-security-policy");
  if (csp && /unsafe-inline|unsafe-eval/i.test(csp)) {
    f.push({
      id: "csp-unsafe",
      cls: "headers",
      severity: "low",
      title: "CSP с unsafe-inline/eval",
      question: "Насколько CSP ещё ограничивает XSS при unsafe-inline?",
      evidence: csp.slice(0, 200),
    });
  }
  const xfo = hget(headers, "x-frame-options");
  const fa = /frame-ancestors/i.test(csp);
  if (!xfo && !fa) {
    f.push({
      id: "clickjack",
      cls: "headers",
      severity: "low",
      title: "Нет защиты от фрейма",
      question: "Есть ли чувствительное действие, которое можно нажать поверх iframe?",
      evidence: "нет X-Frame-Options и frame-ancestors",
    });
  }
  if (!hget(headers, "x-content-type-options")) {
    f.push({
      id: "nosniff",
      cls: "headers",
      severity: "low",
      title: "Нет nosniff",
      question: "Может ли браузер проглотить ответ как скрипт не по Content-Type?",
      evidence: "x-content-type-options отсутствует",
    });
  }

  const acao = hget(headers, "access-control-allow-origin");
  const acac = hget(headers, "access-control-allow-credentials");
  if (acao === "*") {
    f.push({
      id: "cors-star",
      cls: "cors",
      severity: acac && acac.toLowerCase() === "true" ? "high" : "low",
      title: "CORS ACAO = *",
      question: "Какие данные в этом ответе не должны читаться с чужого origin?",
      evidence: `ACAO=* credentials=${acac || "нет"}`,
    });
  }

  const setCookie = hget(headers, "set-cookie");
  if (setCookie) f.push(...cookieFlags(setCookie));

  const mixed = html.match(/\b(?:src|href)\s*=\s*["']http:\/\/[^"']+/gi) || [];
  const httpRes = mixed.filter((u) => !/w3\.org\/2000\/svg/i.test(u));
  if (httpRes.length) {
    f.push({
      id: "mixed",
      cls: "mixed",
      severity: "medium",
      title: "Ссылки http:// на https-странице",
      question: "Грузится ли активный контент по http (скрипт, iframe)?",
      evidence: httpRes.slice(0, 5).join(" | ").slice(0, 300),
    });
  }

  if (/<(script)[^>]+src=["']http:/i.test(html)) {
    f.push({
      id: "mixed-script",
      cls: "mixed",
      severity: "high",
      title: "Скрипт по http",
      question: "Это активный смешанный контент — кто может подменить скрипт на пути?",
      evidence: "script src=http:",
    });
  }

  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) || [];
  for (let i = 0; i < Math.min(forms.length, 12); i++) {
    const form = forms[i];
    const method = (/method=["']?post/i.test(form) ? "POST" : "GET");
    const hasCsrf = /name=["'][^"']*(csrf|_token|authenticity|anti[-_]?forgery)[^"']*["']/i.test(form);
    if (method === "POST" && !hasCsrf) {
      if (/wpcf7|_wpcf7|contact-form-7/i.test(form)) continue;
      f.push({
        id: `form-csrf-${i}`,
        cls: "forms",
        severity: "medium",
        title: "POST-форма без видимого CSRF-поля",
        question: "Токен в cookie SameSite=strict / заголовке? Или состояние меняется без него?",
        evidence: form.replace(/\s+/g, " ").slice(0, 220),
      });
    }
  }

  const inlineHandlers = (html.match(/\son\w+\s*=/gi) || []).length;
  if (inlineHandlers >= 3) {
    f.push({
      id: "inline-handlers",
      cls: "xss",
      severity: "info",
      title: `Инлайн-обработчики: ${inlineHandlers}`,
      question: "Есть ли среди них вывод пользовательских данных?",
      evidence: String(inlineHandlers),
    });
  }
  if (/\beval\s*\(|new\s+Function\s*\(/i.test(html)) {
    f.push({
      id: "eval",
      cls: "xss",
      severity: "low",
      title: "eval / Function в разметке",
      question: "Попадает ли туда строка с клиента?",
      evidence: "eval или new Function",
    });
  }

  const gen = html.match(/<meta[^>]+generator[^>]+content=["']([^"']+)/i);
  if (gen) {
    f.push({
      id: "generator",
      cls: "components",
      severity: "info",
      title: "Meta generator",
      question: "Эта CMS/версия в скоупе и с известными исправлениями?",
      evidence: gen[1].slice(0, 120),
    });
  }

  return f;
}

export function tally(findings: WebFinding[]) {
  const byCls: Record<string, number> = {};
  const bySev: Record<string, number> = {};
  for (const x of findings) {
    byCls[x.cls] = (byCls[x.cls] || 0) + 1;
    bySev[x.severity] = (bySev[x.severity] || 0) + 1;
  }
  return { byCls, bySev, n: findings.length };
}
