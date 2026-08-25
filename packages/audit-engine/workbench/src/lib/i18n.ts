export type Locale = "ru" | "en";

export const DEFAULT_LOCALE: Locale = "ru";
export const LOCALE_COOKIE = "wb_locale";

export function isLocale(value: unknown): value is Locale {
  return value === "ru" || value === "en";
}

export const common = {
  ru: {
    loading: "загрузка…",
    error: "ошибка",
    save: "сохранить",
    cancel: "отмена",
    delete: "удалить",
    search: "поиск",
    all: "все",
    none: "нет",
    yes: "да",
    no: "нет",
    open: "открыть",
    close: "закрыть",
    refresh: "обновить",
    back: "назад",
  },
  en: {
    loading: "loading…",
    error: "error",
    save: "save",
    cancel: "cancel",
    delete: "delete",
    search: "search",
    all: "all",
    none: "none",
    yes: "yes",
    no: "no",
    open: "open",
    close: "close",
    refresh: "refresh",
    back: "back",
  },
} as const;

export function interpolate(text: string, values: Record<string, string | number> = {}) {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}

export function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US").format(value);
}

export function formatMoney(value: number, locale: Locale, currency = "USD") {
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDate(value: string | number | Date, locale: Locale, options?: Intl.DateTimeFormatOptions) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", options).format(date);
}

export function formatDuration(ms: number, locale: Locale) {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)} ${locale === "ru" ? "с" : "s"}`;
  return `${Math.floor(ms / 60000)} ${locale === "ru" ? "мин" : "min"} ${Math.round((ms % 60000) / 1000)} ${locale === "ru" ? "с" : "s"}`;
}

export function formatRelativeDate(value: string, locale: Locale) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  const days = Math.max(0, Math.floor((Date.now() - time) / 86400000));
  const date = formatDate(time, locale, { day: "2-digit", month: "2-digit" });
  if (days === 0) return `${date}, ${locale === "ru" ? "сегодня" : "today"}`;
  if (days === 1) return `${date}, ${locale === "ru" ? "вчера" : "yesterday"}`;
  const relative = new Intl.RelativeTimeFormat(locale === "ru" ? "ru-RU" : "en-US", { numeric: "always" }).format(-days, "day");
  return `${date}, ${relative}`;
}

const STATUS_LABELS: Record<string, [string, string]> = {
  queued: ["в очереди", "queued"],
  running: ["выполняется", "running"],
  done: ["готово", "done"],
  error: ["ошибка", "error"],
  active: ["активен", "active"],
  parked: ["отложен", "parked"],
  watch: ["наблюдение", "watch"],
  killed: ["закрыт", "killed"],
  aborted: ["оборван", "aborted"],
  stopped: ["остановлен", "stopped"],
  canceled: ["отменён", "canceled"],
  incomplete: ["не завершён", "incomplete"],
  lead: ["зацепка", "lead"],
  hotspot: ["горячая точка", "hotspot"],
  clean: ["чисто", "clean"],
  submit: ["к отправке", "submit"],
  scope: ["периметр", "scope"],
  oos: ["вне периметра", "out of scope"],
};

export function formatStatus(status: string, locale: Locale) {
  const pair = STATUS_LABELS[status.toLowerCase()];
  return pair ? pair[locale === "ru" ? 0 : 1] : status;
}
