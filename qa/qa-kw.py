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

for u in ["poster","watcher","other1"]:
    req("POST","/api/register",username=u,password="password",display_name=u.title())
def login(u):
    s,r = req("POST","/api/login",username=u,password="password"); return r["token"]
pt, wt, xt = login("poster"), login("watcher"), login("other1")

# watcher sets keywords
s,r = req("PATCH","/api/me",wt,keywords=["deploy","incident","  spaced out  ",""])
print("set-kw:",s,r["keywords"])

s,sv = req("POST","/api/servers",pt,name="KwTest")
_,full = req("GET",f"/api/servers/{sv['id']}",pt)
code, ch = full["invite_code"], [c for c in full["channels"] if c["kind"]=="text"][0]
req("POST","/api/servers/join",wt,invite_code=code)
req("POST","/api/servers/join",xt,invite_code=code)

def msgs(t): return req("GET",f"/api/channels/{ch['id']}/messages",t)[1]
def buzz(t): return req("GET","/api/buzz",t)[1]

# 1. keyword hit — whole word
s,m = req("POST",f"/api/channels/{ch['id']}/messages",pt,content="the deploy is at 5")
print("hit-post:",s,"mentions:",m.get("mentions"))
print("watcher buzz:",[(b["kind"],b["payload"].get("word")) for b in buzz(wt)])

# 2. partial word should NOT hit ("deployer" isn't "deploy")
s,m = req("POST",f"/api/channels/{ch['id']}/messages",pt,content="deployer is a gem")
print("partial:",s,"mentions:",m.get("mentions"))

# 3. multi-word keyword phrase
s,m = req("POST",f"/api/channels/{ch['id']}/messages",pt,content="we're all spaced out today")
print("phrase:",s,"mentions:",m.get("mentions"))

# 4. @silent suppresses
s,m = req("POST",f"/api/channels/{ch['id']}/messages",pt,content="@silent deploy notes")
print("silent:",s,"mentions:",m.get("mentions"))

# 5. other1 (no keywords) gets nothing; watcher doesn't ping self-posts
s,m = req("POST",f"/api/channels/{ch['id']}/messages",wt,content="deploy me")
print("self-post mentions:",m.get("mentions"))
print("other1 buzz count:",len(buzz(xt)))

# 6. author mention + keyword → single ping
s,m = req("POST",f"/api/channels/{ch['id']}/messages",pt,content="@watcher deploy!")
print("mention+kw:",s,"mentions:",m.get("mentions"))
kws = [b for b in buzz(wt) if b["kind"]=="keyword"]
print("keyword buzzes:",[(b["payload"].get("word"),b["payload"].get("excerpt","")[:30]) for b in kws])
