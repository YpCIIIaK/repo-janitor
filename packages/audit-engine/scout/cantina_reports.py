"""Отчёты Cantina: 756 аудитов с PDF, коммитами и долей исправленного.

ЧЕМ ЭТО СИЛЬНЕЕ CODE4RENA. Там отчёт даёт имена файлов, но заплаток нет —
у них чинит спонсор после конкурса и в отчёт не вносит. Здесь наоборот:
у каждого отчёта есть `commitHashes` (готовые диффы) и `findingStats` с
разбивкой `totalCount`/`fixedCount` по серьёзности. Это прямо кормит
«недочиненную половину».

И связывать можно ТОЧНО: `repositoryLinks` указывает на настоящий
репозиторий протокола, а не на зеркало площадки. Совпадение по имени с его
ложными срабатываниями здесь нужно только как запасной путь.

ГЛАВНОЕ ПРО ЧЕСТНОСТЬ СИГНАЛА. `fixedCount = 0` по всему отчёту почти
никогда не значит «не починили ничего». Замерено: из 51 отчёта публичных
конкурсов у 37 стоит ноль — на конкурсах починку просто не отслеживают.
Принимать это за признание «мы не чинили» значит гнать человека в пустоту.

Настоящий сигнал — ЧАСТИЧНАЯ починка: `0 < fixed < total`. Это команда
своей рукой отметила часть находок исправленными, а часть оставила. Таких
отчётов 139 из 756, и именно они идут первыми.
"""
import re

from .http import get_json

LIST = "https://cantina.xyz/api/v0/reports"
SEV = ("critical", "high", "medium")

STOP = {"finance", "protocol", "protocols", "labs", "network", "foundation",
        "dao", "core", "contracts", "contract", "token", "tokens", "audit",
        "review", "smart", "the", "and", "for", "com", "org", "xyz", "app",
        "monorepo", "repo", "main", "master", "summary", "security"}


def _norm_repo(url):
    """github.com/Owner/Repo/ -> owner/repo. Регистр и хвосты не значат."""
    m = re.search(r"github\.com/([\w.-]+)/([\w.-]+)", str(url or ""))
    if not m:
        return ""
    return "%s/%s" % (m.group(1).lower(),
                      m.group(2).lower().replace(".git", "").rstrip("."))


def _words(s):
    return {w for w in re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).split()
            if len(w) > 2 and w not in STOP}


def stats(row):
    """Сколько critical/high/medium найдено и сколько из них починено."""
    tot = fix = 0
    for s in (row.get("findingStats") or []):
        if s.get("severity") in SEV:
            tot += int(s.get("totalCount") or 0)
            fix += int(s.get("fixedCount") or 0)
    return tot, fix


def grade(row):
    """Насколько отчёту можно верить как указателю на недочиненное.

    partial — команда сама отметила часть находок исправленными, а часть
              оставила. Ради этого всё и затевалось.
    none    — ноль починенных: чаще всего починку не отслеживали вовсе
              (конкурсы), поэтому это «неизвестно», а не «не чинили».
    full    — починено всё; интересны разве что сами диффы.
    empty   — critical/high/medium не было.
    """
    tot, fix = stats(row)
    if not tot:
        return "empty"
    if fix == 0:
        return "none"
    if fix < tot:
        return "partial"
    return "full"


async def fetch(c, limit=1000, fresh=False):
    d = await get_json(c, LIST, {"limit": limit}, ttl=not fresh)
    if isinstance(d, dict):
        d = d.get("reports") or d.get("data") or []
    return d or []


def compact(row):
    tot, fix = stats(row)
    return {
        "id": str(row.get("id") or ""),
        "title": str(row.get("projectTitle") or "")[:80],
        "kind": str(row.get("engagementKind") or ""),
        "pdf": str(row.get("reportPdfLink") or ""),
        "repos": [_norm_repo(u) for u in (row.get("repositoryLinks") or [])
                  if _norm_repo(u)],
        "commits": [str(h)[:40] for h in (row.get("commitHashes") or [])][:8],
        "total": tot, "fixed": fix, "grade": grade(row),
        "at": str(row.get("publishedAt") or "")[:10],
    }


def match(rows, repo="", name=""):
    """Отчёты по мишени. Точное совпадение репозитория, иначе — по словам.

    Порядок важен: репозиторий однозначен, имя — нет. Если репозиторий
    совпал, по имени добирать не надо, иначе к точному ответу
    подмешиваются однофамильцы.
    """
    key = _norm_repo(repo) or (repo or "").strip().lower()
    if key:
        hit = [r for r in rows if key in r["repos"]]
        if hit:
            return hit, "репозиторий"
    want = _words(name)
    if not want:
        return [], ""
    out = [r for r in rows if _words(r["title"]) & want]
    return out, "имя"


def order(rows):
    """Сначала частично починенные, внутри — по числу незакрытых."""
    rank = {"partial": 0, "none": 1, "full": 2, "empty": 3}
    return sorted(rows, key=lambda r: (rank.get(r["grade"], 9),
                                       -(r["total"] - r["fixed"]), r["at"]),
                  reverse=False)
