"""Sherlock. Список конкурсов бедный, но у каждого есть детальная карточка,
и вот в ней лежит всё нужное: размер кода, репозиторий с коммитом, число
принятых находок, языки и полный текст отчёта.
"""
import asyncio

from .http import get_json
from .model import Contest, money, ts

LIST = "https://mainnet-contest.sherlock.xyz/contests"
DONE = ("FINISHED", "SHERLOCK_JUDGING", "JUDGING", "ESCALATING", "COMPLETE")


async def ids(c, pages=40):
    """Обходим постраничный список, собираем id и статусы."""
    out, page, seen = [], 1, set()
    for _ in range(pages):
        d = await get_json(c, LIST, {"page": page}, ttl=False)
        if not d or not d.get("items"):
            break
        for x in d["items"]:
            if x.get("id") not in seen:
                seen.add(x["id"])
                out.append(x)
        nxt = d.get("next_page")
        if not nxt or nxt == page:
            break
        page = nxt
    return out


def _langs(scope):
    """Язык определяем по расширениям файлов в scope, а не по обещаниям."""
    ext = {}
    for repo in scope or []:
        for f in repo.get("files") or []:
            n = str(f.get("name", ""))
            if "." in n:
                e = n.rsplit(".", 1)[1].lower()
                ext[e] = ext.get(e, 0) + int(f.get("nsloc") or 0)
    return tuple(k for k, _ in sorted(ext.items(), key=lambda kv: -kv[1])[:4])


def parse(d, status=""):
    if not d:
        return None
    scope = d.get("scope") or []
    nsloc = int(d.get("nsloc") or 0)
    if not nsloc:
        nsloc = sum(int(r.get("total_nsloc") or 0) for r in scope)
    repos = tuple((r.get("repo", ""), (r.get("commit_hash") or "")[:12],
                   int(r.get("total_nsloc") or 0)) for r in scope)
    return Contest(
        site="sherlock",
        cid=str(d.get("id")),
        name=(d.get("template_repo_name") or d.get("short_description") or "")
             .replace("sherlock-audit/", "")[:44],
        pool=money(d.get("prize_pool")),
        findings=int(d.get("num_competition_issues") or 0),
        nsloc=nsloc,
        langs=_langs(scope),
        kyc=bool(d.get("requires_kyc")),
        start=ts(d.get("starts_at")),
        end=ts(d.get("ends_at")),
        status=status or ("FINISHED" if d.get("report") else ""),
        repos=repos,
        url="https://audits.sherlock.xyz/contests/%s" % d.get("id"),
    )


async def fetch(c, limit=None, conc=8):
    """Список -> детали по каждому конкурсу. Детали кэшируются навсегда."""
    items = await ids(c)
    if limit:
        items = items[:limit]
    sem = asyncio.Semaphore(conc)
    out = []

    async def one(it):
        async with sem:
            # идущий конкурс ещё меняется — его карточку не кэшируем
            fresh = str(it.get("status", "")).upper() not in DONE
            d = await get_json(c, "%s/%s" % (LIST, it["id"]), ttl=not fresh)
            m = parse(d, str(it.get("status") or ""))
            if m:
                out.append(m)

    await asyncio.gather(*(one(i) for i in items))
    return out


async def report(c, cid):
    """Полный текст находок конкурса — сырьё для корпуса."""
    d = await get_json(c, "%s/%s" % (LIST, cid))
    return (d or {}).get("report") or ""
