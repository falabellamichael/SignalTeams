import json, sys, time, urllib.request
sys.stdout.reconfigure(encoding='utf-8')
B = "http://127.0.0.1:8076"
def req(method, path, token=None, **body):
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(B+path, data=data, method=method,
        headers={"Content-Type":"application/json",
                 **({"Authorization":"Bearer "+token} if token else {})})
    try:
        with urllib.request.urlopen(r) as resp: return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
def login(u):
    s,r = req("POST","/api/login",username=u,password="password"); return r["token"]
ot, jt = login("owner1"), login("joiner1")
s,servers = req("GET","/api/servers",ot)
sv = [s for s in servers if s["name"]=="EvTest"][0]
_,full = req("GET",f"/api/servers/{sv['id']}",ot)
ch = [c for c in full["channels"] if c["kind"]=="text"][0]

start = time.time() + 22
s,ev = req("POST",f"/api/servers/{sv['id']}/events",ot,
           name="Demo Time",description="Watch this",starts_at=start,channel_id=ch["id"])
req("POST",f"/api/events/{ev['id']}/interested",jt)
print("scheduled:",ev["id"],"in",round(start-time.time()),"s")
