"""Единая запись конкурса — площадки описывают одно и то же разными словами."""
import dataclasses
import datetime as dt


def money(x):
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


def ts(x):
    """Любой формат времени -> datetime в UTC либо None."""
    if not x:
        return None
    try:
        if isinstance(x, (int, float)):
            return dt.datetime.fromtimestamp(x, dt.timezone.utc)
        return dt.datetime.fromisoformat(str(x).replace("Z", "+00:00"))
    except Exception:
        return None


@dataclasses.dataclass
class Contest:
    site: str                 # sherlock / cantina
    cid: str
    name: str
    pool: float               # призовой фонд, $
    findings: int             # сколько находок принято (0 у идущих)
    nsloc: int                # размер кода в значащих строках
    langs: tuple              # языки из scope
    kyc: bool
    start: object
    end: object
    status: str
    repos: tuple = ()         # (repo, commit, nsloc)
    url: str = ""

    @property
    def days(self):
        if self.start and self.end:
            return max((self.end - self.start).total_seconds() / 86400, 0.0)
        return 0.0

    @property
    def per_finding(self):
        """Сколько досталось на одну находку — мера тесноты."""
        return self.pool / self.findings if self.findings else None

    @property
    def per_ksloc(self):
        """Фонд на тысячу строк кода — сколько денег висит над единицей работы."""
        return self.pool / self.nsloc * 1000 if self.nsloc else None

    @property
    def crowding(self):
        """Находок на тысячу строк. Чем выше, тем плотнее вытоптано."""
        return self.findings / self.nsloc * 1000 if (self.nsloc and self.findings) else None

    def live(self, now=None):
        now = now or dt.datetime.now(dt.timezone.utc)
        return bool(self.start and self.end and self.start <= now <= self.end)

    def upcoming(self, now=None):
        now = now or dt.datetime.now(dt.timezone.utc)
        return bool(self.start and self.start > now)
