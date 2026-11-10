import urllib.request, json, sys

B = 'http://127.0.0.1:8075'
def req(path, tok=None, data=None, method=None):
    r = urllib.request.Request(B + path,
        data=json.dumps(data).encode() if data is not None else None,
        method=method,
        headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'} if tok else {'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())

tok = req('/api/login', data={'username': 'nova', 'password': 'password'})['token']
msgs = [
    "@mike check **this** out — `inline code` and *italic* too",
    "@everyone heads up, deploy at 5",
    "try a ||secret spoiler|| and ~~strike~~ plus @Hive",
]
for c in msgs:
    r = req('/api/channels/1/messages', tok, data={'content': c}, method='POST')
    print('posted', r.get('id'), c[:40])
