import urllib.request, json

B = 'http://127.0.0.1:8075'
def req(path, tok=None, data=None, method=None):
    r = urllib.request.Request(B + path,
        data=json.dumps(data).encode() if data is not None else None,
        method=method,
        headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'} if tok else {'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())

tok = req('/api/login', data={'username': 'mike', 'password': 'password'})['token']
msgs = req('/api/channels/1/messages', tok)
mlist = msgs if isinstance(msgs, list) else msgs.get('messages', [])
mid = mlist[-1]['id']
print('saving mid', mid, req(f'/api/messages/{mid}/save', tok, data={}, method='POST'))
saved = req('/api/saved', tok)
arr = saved if isinstance(saved, list) else saved.get('saved', saved)
print('SAVED', json.dumps(arr)[:600])
