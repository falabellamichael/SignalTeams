import json, sys, urllib.request
sys.stdout.reconfigure(encoding='utf-8')
B = "http://127.0.0.1:8075"
def req(method, path, token=None, **body):
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(B+path, data=data, method=method,
        headers={"Content-Type":"application/json",
                 **({"Authorization":"Bearer "+token} if token else {})})
    try:
        with urllib.request.urlopen(r) as resp: return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')

req("POST","/api/register",username="owner1",password="password",display_name="Owner1")
s,r = req("POST","/api/login",username="owner1",password="password"); ot = r["token"]
s,sv = req("POST","/api/servers",ot,name="TagTest")
sid = sv["id"]

# forum channel with tags
s,fc = req("POST",f"/api/servers/{sid}/channels",ot,name="triage",kind="forum",
           forum_tags=["bug","feature"," question "])
print("create:",s,fc["name"],"tags:",fc["forum_tags"])

# post with valid tags
s,m = req("POST",f"/api/channels/{fc['id']}/messages",ot,
          title="Login broken",content="500 on /login",tags=["bug","feature"])
print("post:",s,"tags:",m.get("tags"))

# post with disallowed tag → 400
s,r = req("POST",f"/api/channels/{fc['id']}/messages",ot,
          title="Nope",content="x",tags=["hack"])
print("bad-tag:",s,r.get("detail"))

# post without tags → fine
s,m2 = req("POST",f"/api/channels/{fc['id']}/messages",ot,title="Idea",content="what if")
print("no-tag:",s,m2.get("tags"))

# PATCH tags
s,fc2 = req("PATCH",f"/api/channels/{fc['id']}",ot,forum_tags=["bug","wontfix"])
print("patch-tags:",s,fc2["forum_tags"])

# old tag no longer allowed
s,r = req("POST",f"/api/channels/{fc['id']}/messages",ot,
          title="F2",content="x",tags=["feature"])
print("stale-tag:",s,r.get("detail"))
