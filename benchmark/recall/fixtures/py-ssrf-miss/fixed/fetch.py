import urllib.request

ALLOWED = {"api.internal.example"}

def proxy(target):
    if urllib.parse.urlparse(target).hostname not in ALLOWED:
        raise ValueError("host not allowed")
    return urllib.request.urlopen(target).read()
