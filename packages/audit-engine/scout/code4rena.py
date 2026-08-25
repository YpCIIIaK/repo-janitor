"""Code4rena — третья площадка, и самая щедрая на данные.

Ранее в проекте было записано, что публичного API у неё нет. Это неверно:
`/api/contests/contests.json` и `/api/v1/contests` действительно отвечают 404,
но `/api/v1/audits` работает и отдаёт 475 аудитов по 25 на страницу.

И отдаёт больше, чем Sherlock с Cantina вместе:

    repo             прямая ссылка на публичный github с кодом
    findingsRepo     репозиторий с находками, issue по одной на находку
    codeAccess       public / private — что вообще можно склонировать
    status           Completed / Active / Upcoming
    hasMandatoryProofOfConcept   требуется ли PoC (сильно влияет на порог входа)
    league           к какой экосистеме относится

`repo` при `codeAccess == "public"` клонируется без ключей, а findingsRepo
даёт разметку находок через github issues. Это второй независимый корпус
вдобавок к отчётам Sherlock.
"""
import datetime as dt

from .http import get_json
from .model import Contest, money, ts

API = "https://code4rena.com/api/v1/audits"


def parse(x):
    amt = str(x.get("formattedAmount") or "")
    pool = money("".join(ch for ch in amt if ch.isdigit() or ch == ".") or 0)
    return Contest(
        site="c4",
        cid=str(x.get("contestId") or x.get("uid") or ""),
        name=str(x.get("title") or x.get("slug") or "")[:44],
        pool=pool,
        findings=0,               # число находок здесь не отдают, только репозиторий
        nsloc=0,
        langs=(),
        kyc=False,
        start=ts(x.get("startTime")),
        end=ts(x.get("endTime")),
        status=str(x.get("status") or ""),
        repos=((x.get("repo") or "", "", 0),) if x.get("repo") else (),
        url="https://code4rena.com/audits/%s" % (x.get("slug") or ""),
    )


async def fetch(c, pages=20, fresh=False):
    out = []
    for p in range(1, pages + 1):
        d = await get_json(c, API, {"page": p}, ttl=not fresh)
        rows = (d or {}).get("data", {}).get("audits") or []
        if not rows:
            break
        out += rows
        pg = (d or {}).get("pagination") or {}
        if not pg.get("nextPage"):
            break
    return out


async def contests(c, fresh=False):
    return [parse(x) for x in await fetch(c, fresh=fresh)]


def live(raw, now=None):
    """Идущие и объявленные — то, куда ещё можно подать."""
    now = now or dt.datetime.now(dt.timezone.utc)
    out = []
    for x in raw:
        s, e = ts(x.get("startTime")), ts(x.get("endTime"))
        if e and e >= now:
            out.append((x, s, e))
    return sorted(out, key=lambda r: r[1] or now)
