"""Cantina. Отдаёт список одним запросом, но без scope и без размера кода —
поэтому здесь известны только фонд и число находок. Детальная карточка
конкурса закрыта (404), так что глубже пройти нечем.
"""
from .http import get_json
from .model import Contest, money, ts

LIST = "https://cantina.xyz/api/v0/competitions"


def parse(x):
    tf = x.get("timeframe") or {}
    return Contest(
        site="cantina",
        cid=str(x.get("id") or x.get("url") or ""),
        name=str(x.get("name") or "")[:44],
        pool=money(x.get("totalRewardPot")),
        findings=int(x.get("totalFindings") or 0),
        nsloc=0,
        langs=(),
        kyc=bool(x.get("kycRequired")),
        start=ts(tf.get("start")),
        end=ts(tf.get("end")),
        status=str(x.get("status") or ""),
        url="https://cantina.xyz/competitions/%s" % (x.get("url") or x.get("id")),
    )


async def fetch(c):
    d = await get_json(c, LIST, ttl=False)
    return [parse(x) for x in d] if isinstance(d, list) else []
