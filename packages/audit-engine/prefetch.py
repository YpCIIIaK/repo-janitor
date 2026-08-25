"""Массовая закачка под медленный интернет. Запускать, когда есть связь.

Всё, что скачано, ложится на диск и второй раз не качается. Прерванный
запуск продолжается с того же места — просто запусти снова.

    python prefetch.py --cards            только карточки конкурсов (~20 МБ)
    python prefetch.py --repos --limit 40 репозитории, 40 штук
    python prefetch.py --repos            все, у кого есть публичное зеркало
    python prefetch.py --status           что уже есть, что осталось

Репозитории берутся по одному, последовательно и мелкой глубиной: на слабом
канале параллельная закачка десятка репозиториев только всё ломает.
"""
import argparse
import asyncio
import json
import pathlib
import subprocess
import time

from scout import corpus, sherlock
from scout.http import CACHE, ROOT, client, get_json

REPOS = ROOT / "data" / "repos"
STATE = ROOT / "data" / "prefetch.json"


def load_state():
    if STATE.exists():
        try:
            return json.loads(STATE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"done": [], "failed": {}}


def save_state(s):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(s, ensure_ascii=False, indent=1), encoding="utf-8")


def repo_dir(repo, commit):
    return REPOS / repo.replace("/", "__") / ((commit or "head")[:12])


def has_code(d):
    d = pathlib.Path(d)
    if not d.exists():
        return False
    return any(p.suffix.lower() in (".sol", ".rs", ".vy", ".move", ".cairo")
               for p in d.rglob("*") if p.is_file())


def clone_one(repo, commit, dst, timeout=600):
    """Один репозиторий, мелкой глубиной, с таймаутом — чтобы висящая
    закачка не съела весь запуск."""
    dst.mkdir(parents=True, exist_ok=True)
    url = "https://github.com/%s.git" % repo
    for cmd in (["git", "init", "-q"], ["git", "remote", "add", "origin", url]):
        subprocess.run(cmd, cwd=dst, capture_output=True, text=True)
    for ref in ([commit] if commit else []) + ["main", "master"]:
        try:
            r = subprocess.run(["git", "fetch", "-q", "--depth", "1", "origin", ref],
                               cwd=dst, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return False, "таймаут"
        if r.returncode == 0:
            subprocess.run(["git", "checkout", "-q", "FETCH_HEAD"],
                           cwd=dst, capture_output=True, text=True)
            return True, ref[:12]
    return False, "не найден"


async def cards(limit=None):
    """Карточки всех конкурсов. Это дёшево и нужно всему остальному."""
    async with client() as c:
        items = await sherlock.ids(c)
        if limit:
            items = items[:limit]
        print("конкурсов в списке: %d" % len(items))
        got = 0
        for i, it in enumerate(items, 1):
            d = await get_json(c, "https://mainnet-contest.sherlock.xyz/contests/%s"
                               % it["id"])
            if d:
                got += 1
            if i % 25 == 0:
                print("  %d/%d скачано" % (i, len(items)))
        print("готово: %d карточек, кэш %d файлов" % (got, len(list(CACHE.glob('*.json')))))


def targets():
    """Что вообще имеет смысл качать: конкурсы со скоупом и отчётом."""
    out = []
    for d in corpus.load_offline():
        if len(d.get("report") or "") < 500:
            continue
        mirror = d.get("template_repo_name")
        for r in d.get("scope") or []:
            out.append({"cid": d.get("id"),
                        "name": (mirror or "").replace("sherlock-audit/", ""),
                        "repo": r.get("repo"), "commit": r.get("commit_hash"),
                        "mirror": mirror,
                        "nsloc": r.get("total_nsloc") or 0})
    return out


def repos(limit=None, retry_failed=False):
    st = load_state()
    done, failed = set(st["done"]), dict(st["failed"])
    tg = targets()
    print("кандидатов: %d, уже скачано: %d, ранее не вышло: %d"
          % (len(tg), len(done), len(failed)))
    n = ok = 0
    t0 = time.time()
    for t in tg:
        key = "%s@%s" % (t["repo"], (t["commit"] or "")[:12])
        if key in done:
            continue
        if key in failed and not retry_failed:
            continue
        if limit and n >= limit:
            break
        n += 1
        dst = repo_dir(t["repo"], t["commit"])
        if has_code(dst):
            done.add(key); ok += 1
            continue
        good, msg = clone_one(t["repo"], t["commit"], dst)
        if not good and t["mirror"]:
            dst2 = repo_dir(t["mirror"], None)
            good, msg = (True, "уже есть") if has_code(dst2) else clone_one(
                t["mirror"], None, dst2)
            if good:
                msg = "зеркало " + msg
        if good:
            done.add(key); ok += 1
        else:
            failed[key] = msg
        print("  [%3d] %-46s %s" % (n, t["repo"][:45], msg))
        st["done"], st["failed"] = sorted(done), failed
        save_state(st)
    print("\nза этот запуск: попыток %d, успешно %d, минут %.1f"
          % (n, ok, (time.time() - t0) / 60))
    print("всего скачано: %d, не вышло: %d" % (len(done), len(failed)))
    print("Запусти снова — продолжит с того же места.")


def status():
    st = load_state()
    tg = targets()
    cached = len(list(CACHE.glob("*.json")))
    withcode = sum(1 for t in tg if has_code(repo_dir(t["repo"], t["commit"])))
    print("=" * 70)
    print("СОСТОЯНИЕ ЗАКАЧКИ")
    print("=" * 70)
    print("  карточек в кэше:        %d" % cached)
    print("  репозиториев в задаче:  %d" % len(tg))
    print("  скачано и с кодом:      %d" % withcode)
    print("  помечено скачанными:    %d" % len(st["done"]))
    print("  не вышло:               %d" % len(st["failed"]))
    if st["failed"]:
        why = {}
        for k, v in st["failed"].items():
            why[v] = why.get(v, 0) + 1
        print("  причины:", ", ".join("%s x%d" % (k, v) for k, v in
                                      sorted(why.items(), key=lambda kv: -kv[1])[:5]))
    mb = sum(f.stat().st_size for f in ROOT.joinpath("data").rglob("*")
             if f.is_file()) / 1e6
    print("  занято на диске:        %.0f МБ" % mb)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cards", action="store_true")
    ap.add_argument("--repos", action="store_true")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--retry", action="store_true", help="повторить ранее неудачные")
    args = ap.parse_args()

    if args.status or not (args.cards or args.repos):
        status()
        return
    if args.cards:
        asyncio.run(cards(args.limit or None))
    if args.repos:
        repos(args.limit or None, args.retry)


if __name__ == "__main__":
    main()
