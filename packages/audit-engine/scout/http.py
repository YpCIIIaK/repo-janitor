"""HTTP с дисковым кэшом.

Конкурсы, которые уже завершились, не меняются никогда. Качать их повторно —
терять время и без нужды долбить чужой сервер. Поэтому всё, что скачано,
ложится в data/cache и больше не запрашивается.
"""
import asyncio
import hashlib
import json
import pathlib

import httpx

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "cache"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Accept": "application/json, text/plain, */*"}


def _key(url, params):
    raw = url + "?" + json.dumps(params or {}, sort_keys=True)
    return hashlib.sha1(raw.encode()).hexdigest()[:20]


def client(timeout=60):
    return httpx.AsyncClient(timeout=timeout, headers=UA, follow_redirects=True)


async def get_json(c, url, params=None, ttl=True, tries=3):
    """ttl=True — брать из кэша навсегда; ttl=False — всегда качать заново."""
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / (_key(url, params) + ".json")
    if ttl and f.exists():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            pass
    for i in range(tries):
        try:
            r = await c.get(url, params=params)
            if r.status_code == 200:
                d = r.json()
                f.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
                return d
            if r.status_code in (404, 403):
                return None
        except Exception:
            pass
        await asyncio.sleep(0.4 * (i + 1))
    return None


async def get_text(c, url, ttl=True, tries=3):
    """То же, что get_json, но для текста: отчёты Code4rena — markdown.

    Завершённый отчёт не меняется никогда, поэтому кэш здесь вечный. 475
    отчётов по 100–200 КБ — это разовые 60 МБ, которые больше не качаются.
    """
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / (_key(url, None) + ".txt")
    if ttl and f.exists():
        try:
            return f.read_text(encoding="utf-8")
        except Exception:
            pass
    for i in range(tries):
        try:
            r = await c.get(url)
            if r.status_code == 200:
                f.write_text(r.text, encoding="utf-8")
                return r.text
            if r.status_code in (404, 403):
                return None
        except Exception:
            pass
        await asyncio.sleep(0.4 * (i + 1))
    return None
