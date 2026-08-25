"""Рынок баунти целиком: шесть площадок, один формат.

До сих пор инструмент видел только Cantina, и выбор мишени упирался в её
семьдесят программ. Здесь собраны все площадки, у которых список программ
достаётся машинно и без ключа:

    cantina       API открыт        комиссия за подачу, KYC, число заявок
    immunefi      public-api        248 программ, 6000+ активов со скоупом
    hackenproof   payload Nuxt      число заявок, теги, ссылки на репозитории
    standoff365   payload Next      СНГ, награды в рублях, веб и приложения
    yeswehack     api.yeswehack     ЕС, веб; число заявок и вилка награды
    sherlock      api контестов     строки type_label = Public Bug Bounty

Чего здесь нет и почему: Intigriti отдаёт список только по токену
исследователя (401), Bugcrowd закрыл programs.json (404), HackerOne без
ключа не отдаёт каталог, у Hats Finance домен API не отвечает. Их надо
смотреть руками, ссылки в market.py.

ЕДИНИЦА — программа, не площадка. Поля приведены к одному виду, поэтому
плотность заявок на актив считается сквозной и мишени сравнимы между собой.
Пустое поле честно пустое: у Immunefi числа заявок нет ни у кого, и
подставлять туда ноль нельзя — ноль означал бы «никто не искал».
"""
import dataclasses
import datetime as _dt
import json
import re

from .http import get_json


def _today():
    return _dt.date.today().isoformat()

RUB_USD = 80.0  # грубо; нужен только чтобы рублёвые программы не были первыми


@dataclasses.dataclass
class Program:
    site: str
    pid: str
    name: str
    url: str
    reward: float = 0.0          # максимальная выплата, в долларах
    currency: str = "USD"
    fee: float = 0.0             # плата за подачу заявки
    kyc: bool = False
    reports: int = -1            # -1 = площадка не публикует
    assets: tuple = ()           # ({"name","type","url"}, ...) в скоупе
    repos: tuple = ()            # ссылки на GitHub, вытащенные из скоупа
    tags: tuple = ()
    updated: str = ""

    @property
    def n_assets(self):
        return len(self.assets)

    @property
    def density(self):
        """Заявок на актив. Единственный измеренный предиктор тесноты."""
        if self.reports < 0 or not self.assets:
            return None
        return self.reports / len(self.assets)

    @property
    def sc(self):
        """Есть ли в скоупе смарт-контракты."""
        blob = " ".join(str(a.get("type", "")) for a in self.assets).lower()
        tags = " ".join(self.tags).lower()
        return ("smart" in blob or "contract" in blob or "solidity" in tags
                or "smart contract" in tags or "blockchain" in tags)


GH = re.compile(r"https?://github\.com/[\w.-]+/[\w.-]+")


def repos_of(assets):
    out = set()
    for a in assets:
        for v in a.values():
            for m in GH.finditer(str(v or "")):
                out.add(m.group(0).rstrip("/.,)"))
    return tuple(sorted(out))


def money(s):
    """«$10,000» / «10 000 ₽» / 10000 -> float."""
    if isinstance(s, (int, float)):
        return float(s or 0)
    digits = re.sub(r"[^\d.]", "", str(s or "").replace(",", ""))
    try:
        return float(digits)
    except ValueError:
        return 0.0


# ---------------------------------------------------------------- cantina

async def cantina(c):
    d = await get_json(c, "https://cantina.xyz/api/v0/bounties", ttl=False)
    out = []
    for p in d or []:
        # kind и status проверяются здесь, а не в CLI: приватная программа
        # (Paxos) однажды съела всю работу уже после готовой находки.
        if p.get("status") != "live" or p.get("kind") == "private_bounty":
            continue
        assets, best = [], 0.0
        for g in p.get("assetGroups") or []:
            if g.get("outOfScope"):
                continue
            for r in g.get("rewards") or []:
                for k in ("amount", "maxAmount", "max", "value"):
                    best = max(best, money(r.get(k)))
            for a in (g.get("assets") or []) + [x for sg in g.get("subGroups") or []
                                                for x in sg.get("assets") or []]:
                assets.append({"name": a.get("name"), "type": "smart_contract",
                               "url": a.get("url") or a.get("link") or "",
                               "desc": a.get("description") or ""})
        out.append(Program(
            site="cantina", pid=str(p.get("id")), name=str(p.get("name") or ""),
            url="https://cantina.xyz/bounties/%s" % p.get("id"),
            reward=best or money(p.get("totalRewardPot")),
            fee=money(p.get("submissionFee")), kyc=bool(p.get("kycRequired")),
            reports=int(p.get("totalFindings") or 0),
            assets=tuple(assets), repos=repos_of(assets),
            updated=str(p.get("updatedAt") or "")[:10]))
    return out


# --------------------------------------------------------------- immunefi

async def immunefi(c):
    d = await get_json(c, "https://immunefi.com/public-api/bounties.json", ttl=False)
    out = []
    for p in d or []:
        if p.get("inviteOnly") or p.get("endDate"):
            continue
        assets = [{"name": a.get("description") or a.get("url"),
                   "type": a.get("type"), "url": a.get("url") or ""}
                  for a in p.get("assets") or []]
        out.append(Program(
            site="immunefi", pid=str(p.get("slug")),
            name=str(p.get("project") or p.get("slug") or ""),
            url="https://immunefi.com/bug-bounty/%s/" % p.get("slug"),
            reward=money(p.get("maxBounty")), kyc=bool(p.get("kyc")),
            reports=-1, assets=tuple(assets), repos=repos_of(assets),
            tags=tuple(p.get("programType") or []),
            updated=str(p.get("updatedDate") or "")[:10]))
    return out


# ------------------------------------------------------------ hackenproof

NUXT = re.compile(r'id="__NUXT_DATA__"[^>]*>(.*?)</script>', re.S)


def _devalue(text):
    """Nuxt пишет payload плоским массивом со ссылками по индексу."""
    arr = json.loads(text)

    def R(i, depth=0):
        if not isinstance(i, int) or i < 0 or i >= len(arr) or depth > 16:
            return i
        v = arr[i]
        if isinstance(v, list):
            if v and v[0] in ("ShallowReactive", "Reactive", "Ref"):
                return R(v[1], depth + 1)
            return [R(j, depth + 1) for j in v]
        if isinstance(v, dict):
            return {k: R(j, depth + 1) for k, j in v.items()}
        return v
    return R(0)


async def _nuxt(c, url):
    r = await c.get(url)
    m = NUXT.search(r.text)
    return _devalue(m.group(1)) if m else None


def _dig(o, key):
    """Все значения по ключу, где угодно в дереве."""
    found = []
    stack = [o]
    while stack:
        x = stack.pop()
        if isinstance(x, dict):
            for k, v in x.items():
                if k == key:
                    found.append(v)
                stack.append(v)
        elif isinstance(x, list):
            stack.extend(x)
    return found


async def hackenproof(c, pages=12):
    """Отсев мёртвых программ ОБЯЗАТЕЛЕН, и это стоило дыры.

    Страница каталога отдаёт вперемешку живые, приостановленные и давно
    ушедшие программы: `state` бывает `published` / `paused` / отсутствует,
    а `activityStatus.name` — `Active` / `Completed`. У ушедших есть ещё
    `downtime` в секундах, и он доходит до лет. Раньше здесь отсекался
    только `archived`, которого в выдаче не бывает вовсе, — то есть не
    отсекалось ничего, и в снимок попадала программа, закрывшаяся годы
    назад. Подать в такую нельзя, а по плотности она выглядит свободной.
    """
    out, seen, dropped = [], set(), 0
    for page in range(1, pages + 1):
        root = await _nuxt(c, "https://hackenproof.com/programs?page=%d" % page)
        got = 0
        for lst in _dig(root or {}, "programs"):
            for p in lst if isinstance(lst, list) else []:
                slug = p.get("slug")
                if not slug or slug in seen:
                    continue
                act = str(((p.get("activityStatus") or {}) if isinstance(
                    p.get("activityStatus"), dict) else {}).get("name") or "")
                # `state` отсутствует у врезки «программа недели» — там нет
                # полей состояния, и такие записи дублируют каталог.
                if p.get("state") != "published" or act == "Completed":
                    seen.add(slug)
                    dropped += 1
                    continue
                seen.add(slug)
                got += 1
                tags = p.get("tags") or {}
                flat = [str(t) for v in tags.values() if isinstance(v, list)
                        for t in v]
                out.append(Program(
                    site="hackenproof", pid=slug, name=str(p.get("name") or ""),
                    url="https://hackenproof.com/programs/%s" % slug,
                    reward=money(p.get("reward")),
                    reports=int(p.get("submittedReports") or 0),
                    tags=tuple(flat), updated=str(p.get("lastUpdated") or "")))
        if not got:
            break
    if dropped:
        print("    hackenproof: отброшено закрытых и приостановленных: %d" % dropped)
    return out


async def hackenproof_scope(c, slug):
    root = await _nuxt(c, "https://hackenproof.com/programs/%s" % slug)
    assets = []
    for lst in _dig(root or {}, "scopes"):
        for s in lst if isinstance(lst, list) else []:
            if not isinstance(s, dict) or s.get("out_of_scope"):
                continue
            assets.append({"name": s.get("target_description") or s.get("target"),
                           "type": s.get("type") or "",
                           "url": s.get("target") or "",
                           "desc": s.get("criticality") or ""})
    return assets


# ------------------------------------------------------------ standoff365

NEXT = re.compile(r'id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)
SITE365 = "https://bugbounty.standoff365.com"


async def _build_id(c):
    r = await c.get(SITE365 + "/en-US/programs")
    m = NEXT.search(r.text)
    return json.loads(m.group(1))["buildId"] if m else None


async def standoff(c, pages=12):
    bid = await _build_id(c)
    if not bid:
        return []
    out, seen = [], set()
    for page in range(1, pages + 1):
        d = await get_json(c, "%s/_next/data/%s/en-US/programs.json" % (SITE365, bid),
                           {"page": page}, ttl=False)
        pp = (d or {}).get("pageProps") or {}
        got = 0
        for p in pp.get("programs") or []:
            slug = p.get("slug")
            if not slug or slug in seen or p.get("finished") or \
                    p.get("archivedAt") or p.get("status") != "published":
                continue
            seen.add(slug)
            got += 1
            rub = (((p.get("statistics") or {}).get("rewards") or {})
                   .get("rub") or {})
            out.append(Program(
                site="standoff", pid=slug, name=str(p.get("name") or ""),
                url="%s/programs/%s" % (SITE365, slug),
                reward=money(rub.get("max")) / RUB_USD, currency="RUB",
                kyc=bool(p.get("needsConfirmation")),
                tags=(str((p.get("vendor") or {}).get("name") or ""),),
                updated=str(p.get("updatedAt") or "")[:10]))
        if not got:
            break
    return out


async def standoff_scope(c, slug):
    """Скоупа отсюда НЕ ДОСТАТЬ, и это проверено, а не предположено.

    Карточка программы отдаёт `pageProps.scopes` пустым списком, а
    `/backend/api/...` из браузера отвечает 404 без сессии. Значит, у
    Standoff скоуп виден только вошедшему. Поэтому площадка не входит в
    SCOPE: гонять по ней 199 запросов ради пустых списков — трата.
    """
    return []


# ------------------------------------------------------------- yeswehack

async def yeswehack(c, pages=6):
    out = []
    for page in range(1, pages + 1):
        d = await get_json(c, "https://api.yeswehack.com/programs",
                           {"page": page}, ttl=False)
        items = (d or {}).get("items") or []
        for p in items:
            if p.get("archived") or p.get("disabled") or not p.get("public"):
                continue
            # `bounty=false` — программа без денег (VDP, зал славы). Для нас
            # это не мишень: работа есть, выплаты нет.
            if not p.get("bounty"):
                continue
            out.append(Program(
                site="yeswehack", pid=str(p.get("slug")),
                name=str(p.get("title") or ""),
                url="https://yeswehack.com/programs/%s" % p.get("slug"),
                reward=money(p.get("bounty_reward_max")),
                currency=str(((p.get("business_unit") or {}).get("currency"))
                             or "EUR"),
                reports=int(p.get("reports_count") or 0),
                assets=tuple({"name": "", "type": "web"} for _ in
                             range(int(p.get("scopes_count") or 0))),
                tags=(str(p.get("activity_area") or ""),)))
        if page >= int((d or {}).get("pagination", {}).get("nb_pages") or 1):
            break
    return out


async def yeswehack_scope(c, slug):
    d = await get_json(c, "https://api.yeswehack.com/programs/%s" % slug, ttl=False)
    return [{"name": s.get("scope"), "type": s.get("scope_type_name") or "",
             "url": "", "desc": s.get("asset_value") or ""}
            for s in (d or {}).get("scopes") or []]


# -------------------------------------------------------------- sherlock

async def sherlock(c):
    out = []
    d = await get_json(c, "https://audits.sherlock.xyz/api/contests", ttl=False)
    for x in (d or {}).get("items") or []:
        if "bug bounty" not in str(x.get("type_label") or "").lower():
            continue
        out.append(Program(
            site="sherlock", pid=str(x.get("id")),
            name=str(x.get("title") or x.get("short_description") or ""),
            url="https://audits.sherlock.xyz/contests/%s" % x.get("id"),
            reward=money(x.get("prize_pool") or x.get("rewards")),
            tags=("smart contract",)))
    return out


# -------------------------------------------------------------- hackerone

async def hackerone(c, pages=6):
    """Каталог отдаётся БЕЗ ключа — но без наград и без скоупа.

    `/programs/search` — тот же эндпоинт, которым живёт страница каталога.
    Он даёт имя, дескриптор, состояние приёма и число РЕШЁННЫХ отчётов.
    Ни вилки наград, ни активов там нет, а `/policy_scopes` и `/graphql`
    отвечают 404 без сессии. Поэтому плотность по H1 не считается вовсе:
    делить нечего и не на что.
    """
    out, seen = [], set()
    for page in range(1, pages + 1):
        # Заголовок Accept здесь ОБЯЗАН быть ровно "application/json":
        # с общим "application/json, text/plain, */*" H1 отвечает 406.
        r = await c.get("https://hackerone.com/programs/search",
                        params={"query": "type:hackerone", "page": page,
                                "sort": "published_at:descending"},
                        headers={"Accept": "application/json"})
        d = r.json() if r.status_code == 200 else {}
        rows = d.get("results") or []
        if not rows:
            break
        for x in rows:
            h = x.get("handle")
            meta = x.get("meta") or {}
            if not h or h in seen or meta.get("submission_state") != "open":
                continue
            seen.add(h)
            out.append(Program(
                site="hackerone", pid=h, name=str(x.get("name") or h),
                url="https://hackerone.com/%s" % h,
                reports=-1,
                tags=("решено отчётов %s" % (meta.get("resolved_report_count") or 0),
                      "триаж" if meta.get("triage_active") else "")))
        if len(rows) < int((d or {}).get("limit") or 100):
            break
    return out


# --------------------------------------------------------------- bugcrowd

async def bugcrowd(c, pages=12):
    """`engagements.json` открыт (это `programs.json` был 404 и сбил нас).

    Пустая вилка наград здесь означает VDP — раскрытие без денег. Работа
    та же, выплаты нет, и в каталоге мишеней такому не место.
    """
    out, seen, vdp = [], set(), 0
    for page in range(1, pages + 1):
        d = await get_json(c, "https://bugcrowd.com/engagements.json",
                           {"category": "bug_bounty", "page": page}, ttl=False)
        rows = (d or {}).get("engagements") or []
        if not rows:
            break
        for x in rows:
            brief = str(x.get("briefUrl") or "")
            if not brief or brief in seen or x.get("isDemo") or x.get("isBanned"):
                continue
            # программа с проставленной датой конца уже не принимает заявки
            if x.get("endsAt") and str(x["endsAt"])[:10] < _today():
                continue
            seen.add(brief)
            rew = x.get("rewardSummary") or {}
            if not money(rew.get("maxReward")):
                vdp += 1
                continue
            out.append(Program(
                site="bugcrowd", pid=brief.rsplit("/", 1)[-1],
                name=str(x.get("name") or ""),
                url="https://bugcrowd.com" + brief,
                reward=money(rew.get("maxReward")),
                reports=-1,
                tags=(str(x.get("industryName") or ""),
                      str(x.get("accessStatus") or ""))))
    if vdp:
        print("    bugcrowd: отброшено VDP без выплат: %d" % vdp)
    return out


# -------------------------------------------------------------- intigriti

EUR_USD = 1.08


async def intigriti(c):
    """Открыт не `api.intigriti.com` (401/404), а `app.intigriti.com/api`."""
    d = await get_json(c, "https://app.intigriti.com/api/core/public/programs",
                       ttl=False)
    out, vdp = [], 0
    for x in d or []:
        if x.get("status") != 3:            # 3 — приём открыт, 4 — закрыт
            continue
        mx = (x.get("maxBounty") or {}).get("value") or 0
        cur = (x.get("maxBounty") or {}).get("currency") or "EUR"
        if not mx:                      # VDP: раскрытие без денег
            vdp += 1
            continue
        out.append(Program(
            site="intigriti", pid=str(x.get("handle")),
            name=str(x.get("name") or ""),
            url="https://app.intigriti.com/researcher/programs/%s/%s/detail"
                % (x.get("companyHandle"), x.get("handle")),
            reward=money(mx) * (EUR_USD if cur == "EUR" else 1.0),
            currency=cur, reports=-1,
            kyc=bool(x.get("tacRequired")),
            tags=(str(x.get("industry") or ""),)))
    if vdp:
        print("    intigriti: отброшено VDP без выплат: %d" % vdp)
    return out


# ---------------------------------------------------------------- bi.zone

BIZONE = "https://bugbounty.bi.zone"


async def _bz(c, path, pages=8):
    """DRF-пагинация. limit режется сервером до 100, сколько ни проси."""
    out = []
    for i in range(pages):
        d = await get_json(c, BIZONE + path,
                           {"limit": 100, "offset": i * 100}, ttl=False)
        out += (d or {}).get("results") or []
        if not (d or {}).get("next"):
            break
    return out


async def bizone(c):
    """Площадка BI.ZONE (Россия). Скоуп открыт БЕЗ логина — редкость.

    Программа у них называется компанией, а актив — задачей (task), и
    лежат они в двух разных ручках. Поэтому склеиваем: компания даёт
    имя и число заявок, задачи — скоуп. Это единственная из площадок
    СНГ, где плотность считается честно, потому что открыты оба числа.

    Максимальной выплаты они не публикуют вовсе — только сумму и среднее
    по уже выплаченному. Ставить среднее в поле «максимум» нельзя: оно
    поедет в график «приз против тесноты» и соврёт там. Оставляем 0 =
    неизвестно.
    """
    comps = await _bz(c, "/api/bug-bounty/companies/")
    tasks = await _bz(c, "/api/bug-bounty/tasks/")
    by = {}
    for t in tasks:
        # inArchive — задача снята, inScope False — явно вне скоупа.
        if t.get("inArchive") or not t.get("inScope"):
            continue
        cid = (t.get("company") or {}).get("id")
        if not cid:
            continue
        by.setdefault(cid, []).append({
            "name": str(t.get("textTask") or "")[:120],
            "type": str(t.get("criticalType") or ""),
            "url": "", "desc": str(t.get("description") or "")[:400]})
    out = []
    for co in comps:
        cid = co.get("id") or co.get("slug")
        if not cid or not co.get("public"):
            continue
        assets = tuple(by.get(cid) or ())
        # Компания без единой живой задачи — это витрина, а не программа.
        if not assets:
            continue
        out.append(Program(
            site="bizone", pid=str(cid), name=str(co.get("name") or cid),
            url="%s/companies/%s" % (BIZONE, cid),
            reward=0.0, currency="RUB",
            reports=int(co.get("allReportCount") or 0),
            assets=assets, repos=repos_of(assets),
            updated=str(co.get("registrationDate") or "")[:10]))
    return out


SOURCES = {"cantina": cantina, "immunefi": immunefi, "hackenproof": hackenproof,
           "standoff": standoff, "yeswehack": yeswehack, "sherlock": sherlock,
           "hackerone": hackerone, "bugcrowd": bugcrowd, "intigriti": intigriti,
           "bizone": bizone}

SCOPE = {"hackenproof": hackenproof_scope, "yeswehack": yeswehack_scope}
