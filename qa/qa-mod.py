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

for u in ["owner1","naughty"]:
    s,_ = req("POST","/api/register",username=u,password="password",display_name=u.title())
    if s not in (200,201,409): print("reg",u,s)
def login(u):
    s,r = req("POST","/api/login",username=u,password="password"); return r["token"]
ot, nt = login("owner1"), login("naughty")
s,sv = req("POST","/api/servers",ot,name="ModTest")
sid = sv["id"]
_,full = req("GET",f"/api/servers/{sid}",ot)
code, ch = full["invite_code"], [c for c in full["channels"] if c["kind"]=="text"][0]
s,me = req("GET","/api/me",nt); nid = me["id"]
req("POST","/api/servers/join",nt,invite_code=code)

# member posts fine
s,_ = req("POST",f"/api/channels/{ch['id']}/messages",nt,content="hi all")
print("post:",s)

# timeout 5min → posting blocked
s,r = req("POST",f"/api/servers/{sid}/members/{nid}/timeout",ot,minutes=5)
print("timeout:",s,r)
s,r = req("POST",f"/api/channels/{ch['id']}/messages",nt,content="spam")
print("timed-post:",s,r.get("detail"))

# clear timeout → posts work
req("POST",f"/api/servers/{sid}/members/{nid}/timeout",ot,minutes=0)
s,r = req("POST",f"/api/channels/{ch['id']}/messages",nt,content="I'm back")
print("cleared-post:",s)

# ban → kicked + can't rejoin
s,r = req("POST",f"/api/servers/{sid}/bans/{nid}",ot,reason="spamming")
print("ban:",s,r)
s,r = req("POST","/api/servers/join",nt,invite_code=code)
print("rejoin:",s,r.get("detail"))

# ban list + unban → rejoin works
s,bans = req("GET",f"/api/servers/{sid}/bans",ot)
print("bans:",s,[(b["username"],b["reason"]) for b in bans])
s,r = req("DELETE",f"/api/servers/{sid}/bans/{nid}",ot)
print("unban:",s,r)
s,r = req("POST","/api/servers/join",nt,invite_code=code)
print("rejoin2:",s)

# non-owner can't ban
s,r = req("POST",f"/api/servers/{sid}/bans/{nid}",nt,reason="lol")
print("member-ban:",s,r.get("detail"))

# audit feed has the rows
s,audit = req("GET",f"/api/servers/{sid}/audit",ot)
print("audit:",[a["action"] for a in audit])
