# -*- coding: utf-8 -*-
import webaudit

def test_cloudflare_403_blocked():
    r = webaudit.detect_block(403, {"server":"cloudflare","cf-ray":"x"}, "Attention Required! Cloudflare")
    assert r and "cloudflare" in r.lower()
def test_challenge_body():
    r = webaudit.detect_block(503, {"server":"cloudflare"}, "Just a moment... challenge-platform")
    assert r
def test_normal_200_not_blocked():
    assert webaudit.detect_block(200, {"server":"nginx"}, "<html>app</html>") is None
def test_403_app_without_waf_not_flagged_as_waf():
    # обычный 403 без WAF-маркеров и без cf — не помечаем как WAF-блок
    assert webaudit.detect_block(403, {"server":"nginx"}, "<html>forbidden page</html>") is None

if __name__=="__main__":
    for k,v in sorted(globals().items()):
        if k.startswith("test_"): v()
    print("ok")
