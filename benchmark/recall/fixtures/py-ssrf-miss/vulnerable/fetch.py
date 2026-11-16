import urllib.request

def proxy(target):
    return urllib.request.urlopen(target).read()
