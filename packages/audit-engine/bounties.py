"""Баунти-программы: что открыто прямо сейчас и куда идти.

Конкурсы идут раундами и сейчас не идут нигде. Баунти открыты всегда, и по
измеренному закону плотности они выгоднее: скоуп там — весь задеплоенный
протокол, десятки тысяч строк, то есть покрытие тонкое по построению.

    python bounties.py              живые программы, отсортированные
    python bounties.py --id <id>    скоуп конкретной программы
    python bounties.py --all        включая непубличные и завершённые

Источник — открытый API Cantina, ключей не требует. Immunefi и HackenProof
закрыты (404 и Cloudflare), у Hats домен не отвечает.

ВАЖНО ПРО ДЕНЬГИ. У части программ есть submissionFee — плата за подачу
заявки, от 5 до 100$. Это анти-спам, и он же делает отрицательным матожидание
для тех, кто подаёт наугад. Программы без комиссии показываются первыми.
"""
import argparse
import asyncio
import re

from scout.http import client, get_json

API = "https://cantina.xyz/api/v0/bounties"


def scope_of(p):
    """Активы в скоупе: (в скоупе, вне скоупа, ссылки на репозитории)."""
    inn, out, repos = [], [], set()
    for g in p.get("assetGroups") or []:
        bucket = out if g.get("outOfScope") else inn
        for a in g.get("assets") or []:
            bucket.append(a)
            for f in (a.get("name"), a.get("description"), a.get("url"),
                      a.get("link"), a.get("target")):
                for m in re.finditer(r"https?://github\.com/[\w.-]+/[\w.-]+", str(f or "")):
                    repos.add(m.group(0).rstrip("/.,)"))
        for sg in g.get("subGroups") or []:
            for a in sg.get("assets") or []:
                bucket.append(a)
    return inn, out, sorted(repos)


def max_reward(p):
    best = 0.0
    for g in p.get("assetGroups") or []:
        if g.get("outOfScope"):
            continue
        for r in g.get("rewards") or []:
            for k in ("amount", "maxAmount", "max", "value"):
                try:
                    best = max(best, float(r.get(k) or 0))
                except (TypeError, ValueError):
                    pass
    return best or float(p.get("totalRewardPot") or 0)


def fee(p):
    try:
        return float(p.get("submissionFee") or 0)
    except (TypeError, ValueError):
        return 0.0


def m(x):
    return "{:,.0f}".format(x) if x else "-"


async def fetch(c):
    d = await get_json(c, API, ttl=False)
    return d if isinstance(d, list) else []


def table(progs):
    print("=" * 108)
    print("ЖИВЫЕ БАУНТИ-ПРОГРАММЫ")
    print("=" * 108)
    print("%-26s%12s%9s%8s%8s%9s%11s%8s"
          % ("программа", "макс.", "подано", "активов", "репо", "комис.",
             "подано/актив", "KYC"))
    print("-" * 108)
    rows = []
    skipped = 0
    for p in progs:
        # ТОЛЬКО живые. Статусы judging / escalations_ended / complete означают
        # закрытую программу: заявки больше не принимают. Опаснее всего то, что
        # у закрытых МАЛО заявок — они выглядят самыми свободными и всплывают
        # наверх сортировки по плотности. 11.08.2026 это едва не увело нас на
        # panoptic-core (24 заявки, статус judging) и royco («no longer active»).
        if str(p.get("status")) != "live":
            skipped += 1
            continue
        inn, out, repos = scope_of(p)
        n = len(inn) or 1
        found = int(p.get("totalFindings") or 0)
        rows.append({
            "p": p, "inn": len(inn), "repos": repos, "found": found,
            "dens": found / n, "fee": fee(p), "rew": max_reward(p),
            "kyc": bool(p.get("kycRequired")),
        })
    # сортировка: сначала без комиссии, потом по возрастанию плотности
    rows.sort(key=lambda r: (r["fee"] > 0, r["kyc"], r["dens"]))
    for r in rows[:28]:
        p = r["p"]
        print("%-26s%12s%9d%8d%8d%9s%11.1f%8s"
              % (str(p.get("name"))[:25], m(r["rew"]), r["found"], r["inn"],
                 len(r["repos"]), ("%.0f$" % r["fee"]) if r["fee"] else "нет",
                 r["dens"], "да" if r["kyc"] else ""))
    if skipped:
        print("\nскрыто закрытых программ (judging/escalations_ended/complete): %d"
              % skipped)
    print("""
«подано/актив» — сколько заявок пришлось на один актив скоупа. Это та же
плотность покрытия, которая на конкурсах оказалась единственным
предиктором шанса оказаться единственным нашедшим (r = -0.67). Меньше —
лучше.

Комиссия за подачу делает наугад поданную заявку убыточной: при 50$ и
типичной доле валидных находок в пару процентов подавать «на всякий
случай» нельзя. Программы без комиссии стоят выше.

Полный скоуп программы: python bounties.py --id <id>""")


def detail(p):
    inn, out, repos = scope_of(p)
    print("=" * 100)
    print("%s — %s" % (p.get("name"), (p.get("company") or {}).get("name")))
    print("=" * 100)
    print("статус: %s   максимальная награда: %s %s   комиссия за подачу: %s"
          % (p.get("status"), m(max_reward(p)), p.get("currencyCode"),
             ("%.0f$" % fee(p)) if fee(p) else "нет"))
    print("подано заявок: %s   KYC: %s   триаж Cantina: %s"
          % (p.get("totalFindings"), "да" if p.get("kycRequired") else "нет",
             p.get("cantinaTriaged")))
    print("ссылка: %s" % p.get("url"))
    print("\nАКТИВЫ В СКОУПЕ: %d" % len(inn))
    for a in inn[:40]:
        print("  - %s" % str(a.get("name"))[:92])
    if len(inn) > 40:
        print("  ... ещё %d" % (len(inn) - 40))
    if out:
        print("\nВНЕ СКОУПА: %d" % len(out))
        for a in out[:10]:
            print("  - %s" % str(a.get("name"))[:92])
    if repos:
        print("\nРЕПОЗИТОРИИ, НАЙДЕННЫЕ В ОПИСАНИИ:")
        for r in repos:
            print("  %s" % r)
    ins = str(p.get("instructions") or "")
    if ins:
        print("\nЧТО ИЩУТ (из инструкции программы):")
        for line in ins.splitlines()[:24]:
            if line.strip():
                print("  %s" % line[:96])


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--orgs", action="store_true",
                    help="организации GitHub открытых программ без комиссии и KYC")
    args = ap.parse_args()

    async with client() as c:
        progs = await fetch(c)
    if not progs:
        print("Cantina не ответила")
        return
    if args.id:
        for p in progs:
            if str(p.get("id")).startswith(args.id) or \
               args.id.lower() in str(p.get("name")).lower():
                detail(p)
                return
        print("программа не найдена")
        return
    if args.all:
        # `--all` снимает фильтр по kind, но НЕ по статусу: закрытая программа
        # мишенью быть не может ни при каких условиях.
        live = [p for p in progs if p.get("status") == "live"]
    else:
        # ПОЛЕ kind ОБЯЗАТЕЛЬНО. Без этой проверки селектор однажды привёл в
        # Paxos — программу `private_bounty`, куда нас просто не пустили,
        # уже после того как находка была готова. Таких программ всего две
        # из семидесяти одной, и цена ошибки — вся работа впустую.
        live = [p for p in progs
                if p.get("status") == "live" and p.get("kind") != "private_bounty"]
    hidden = len([p for p in progs if p.get("kind") == "private_bounty"])
    closed = len([p for p in progs if p.get("status") != "live"])
    print("всего программ %d, живых %d (закрытых %d, приватных %d)\n"
          % (len(progs), len(live), closed, hidden))

    if args.orgs:
        orgs = {}
        for p in live:
            if fee(p) > 0 or p.get("kycRequired"):
                continue
            _, _, repos = scope_of(p)
            for r in repos:
                orgs.setdefault(r.split("/")[3], set()).add(p.get("name"))
        for org in sorted(orgs):
            print("%-28s %s" % (org, ", ".join(sorted(orgs[org]))[:70]))
        print("\nПодать в audits.py:  python audits.py --org <имя>")
        return
    table(live)


if __name__ == "__main__":
    asyncio.run(main())
