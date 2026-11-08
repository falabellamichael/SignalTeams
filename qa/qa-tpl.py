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

for u in ["owner1","cloner"]:
    req("POST","/api/register",username=u,password="password",display_name=u.title())
def login(u):
    s,r = req("POST","/api/login",username=u,password="password"); return r["token"]
ot, ct = login("owner1"), login("cloner")

s,sv = req("POST","/api/servers",ot,name="TplSrc")
sid = sv["id"]
# add a role + gated channel + automod + slowmode forum
s,role = req("POST",f"/api/servers/{sid}/roles",ot,name="mods",color="#f2644c")
print("role:",s,role.get("id"))
s,fc = req("POST",f"/api/servers/{sid}/channels",ot,name="announce",kind="forum",
           topic="news",category="Info",role_id=role["id"])
print("forum ch:",s,fc.get("name"),fc.get("kind"),"role:",fc.get("role_id"))
req("PATCH",f"/api/servers/{sid}",ot,automod={"words":["damn"],"block_links":True})

# template
s,t = req("POST",f"/api/servers/{sid}/template",ot)
print("template:",s,t)
# non-owner can't
s,r = req("POST",f"/api/servers/{sid}/template",ct)
print("member-tpl:",s,r.get("detail"))

# preview (public — no token)
s,p = req("GET",f"/api/templates/{t['code']}")
print("preview:",s,p["name"],p["channels"],p["roles"],p["uses"])

# instantiate as cloner
s,ns = req("POST","/api/servers/from-template",ct,code=t["code"])
print("clone:",s,ns["name"])
nsid = ns["id"]
_,nfull = req("GET",f"/api/servers/{nsid}",ct)
print("clone channels:",[(c["name"],c["kind"],c["role_id"],c["category"]) for c in nfull["channels"]])
print("clone roles:",nfull["roles"])
print("clone automod:",nfull["automod"])
print("uses now:",req("GET",f"/api/templates/{t['code']}")[1]["uses"])

# refresh keeps same code
s,t2 = req("POST",f"/api/servers/{sid}/template",ot)
print("sync same-code:",t2["code"]==t["code"])
# delete
s,_ = req("DELETE",f"/api/servers/{sid}/template",ot)
s,r = req("GET",f"/api/templates/{t['code']}")
print("after-del:",s,r.get("detail"))
