import json, sys, urllib.request
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

for u in ["owner1","joiner1"]:
    s,_ = req("POST","/api/register",username=u,password="password",display_name=u.title())
    if s not in (200,201,400): print("reg",u,s)

def login(u):
    s,r = req("POST","/api/login",username=u,password="password")
    return r["token"]

ot, jt = login("owner1"), login("joiner1")
s,sv = req("POST","/api/servers",ot,name="SysTest")
sid = sv["id"]
_,full = req("GET",f"/api/servers/{sid}",ot)
ch = [c for c in full["channels"] if c["kind"]=="text"][0]
print("invite:",full["invite_code"],"| channel:",ch["id"],ch["name"])

s,r = req("POST","/api/servers/join",jt,invite_code=full["invite_code"])
print("join:",s)
_,msgs = req("GET",f"/api/channels/{ch['id']}/messages",jt)
for m in msgs:
    print(" msg:",m.get("system"),m["author"]["username"],repr(m["content"][:40]))

s,r = req("POST",f"/api/servers/{sid}/leave",jt)
print("leave:",s,r)
_,msgs = req("GET",f"/api/channels/{ch['id']}/messages",ot)
for m in msgs:
    print(" msg:",m.get("system"),m["author"]["username"],repr(m["content"][:40]))

# rejoin → second join sysmsg
req("POST","/api/servers/join",jt,invite_code=full["invite_code"])
_,msgs = req("GET",f"/api/channels/{ch['id']}/messages",ot)
print("final:",[(m.get("system"),m["author"]["username"]) for m in msgs])
