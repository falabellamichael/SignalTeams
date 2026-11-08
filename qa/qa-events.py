import json, sqlite3, sys, time, urllib.request
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
    if s not in (200,201,409): print("reg",u,s)
def login(u):
    s,r = req("POST","/api/login",username=u,password="password"); return r["token"]
ot, jt = login("owner1"), login("joiner1")
s,sv = req("POST","/api/servers",ot,name="EvTest")
sid = sv["id"]
_,full = req("GET",f"/api/servers/{sid}",ot)
code = full["invite_code"]
ch = [c for c in full["channels"] if c["kind"]=="text"][0]
req("POST","/api/servers/join",jt,invite_code=code)

# create (member can create — joiner does)
start = time.time() + 90
s,ev = req("POST",f"/api/servers/{sid}/events",jt,
           name="Launch Party", description="Ship it", starts_at=start, channel_id=ch["id"])
print("create:",s, ev["id"], ev["name"], ev["channel_name"], ev["interested_count"], ev["me_interested"])
eid = ev["id"]

# past event rejected
s,r = req("POST",f"/api/servers/{sid}/events",ot,name="Past",starts_at=time.time()-3600)
print("past:",s,r.get("detail"))

# list
s,lst = req("GET",f"/api/servers/{sid}/events",ot)
print("list:",s,[(e["name"],e["status"],e["interested_count"]) for e in lst])

# interested toggle (owner marks interested)
s,r = req("POST",f"/api/events/{eid}/interested",ot)
print("interest:",s,r["me_interested"],r["interested_count"])

# edit (creator)
s,r = req("PATCH",f"/api/events/{eid}",jt,name="Launch Party v2",
          description="Ship it harder",starts_at=start+60,channel_id=ch["id"])
print("edit:",s,r["name"],r["starts_at"]==start+60)

# non-privileged user can't cancel (need a third user)... skip; owner can
s,r = req("DELETE",f"/api/events/{eid}",ot)
print("cancel:",s,r)
s,lst = req("GET",f"/api/servers/{sid}/events",ot)
print("after-cancel:",s,lst)

# new event due in ~35s → event_loop (20s poll) flips it live + bot announces + buzz
start2 = time.time() + 25
s,ev2 = req("POST",f"/api/servers/{sid}/events",ot,
            name="Standup",description="",starts_at=start2,channel_id=ch["id"])
req("POST",f"/api/events/{ev2['id']}/interested",jt)
print("due-event:",s,ev2["id"],"starts in",round(start2-time.time()),"s")
