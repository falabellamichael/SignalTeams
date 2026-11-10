import urllib.request, json
B = 'http://127.0.0.1:8075'
def req(path, tok=None, data=None, method=None):
    h = {'Content-Type': 'application/json'}
    if tok: h['Authorization'] = 'Bearer ' + tok
    r = urllib.request.Request(B + path,
        data=json.dumps(data).encode() if data is not None else None,
        method=method, headers=h)
    try: return json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e: return {'err': e.code, 'body': e.read()[:200]}

j = req('/api/login', data={'username':'juno','password':'password'})['token']
print('juno->mike:', req('/api/friends', j, {'username':'mike'}, 'POST'))
m = req('/api/login', data={'username':'mike','password':'password'})['token']
print('mike friends:', json.dumps(req('/api/friends', m))[:400])
