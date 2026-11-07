import json, time, urllib.request

H = {"Content-Type": "application/json"}

def req(m, p, d=None, t=None):
    r = urllib.request.Request("http://127.0.0.1:8075" + p, method=m,
        data=json.dumps(d).encode() if d is not None else None,
        headers={**H, **({"Authorization": "Bearer " + t} if t else {})})
    return json.loads(urllib.request.urlopen(r).read())

tok = req("POST", "/api/login", {"username": "mike", "password": "password"})["token"]
servers = req("GET", "/api/servers", t=tok)
ch = None
for s in servers:
    det = req("GET", "/api/servers/" + str(s["id"]), t=tok)
    for c in det.get("channels", []):
        if c["name"] == "general":
            ch = c
print("channel", ch["id"])
m = req("POST", "/api/channels/" + str(ch["id"]) + "/messages",
        {"content": "@souschef what should I make with leftover rice?"}, t=tok)
print("sent", m["id"])
for i in range(35):
    time.sleep(2)
    ms = req("GET", "/api/channels/" + str(ch["id"]) + "/messages", t=tok)
    bot = [x for x in ms if x["author"]["username"].startswith("agent:")]
    if bot:
        b = bot[-1]
        print("BOT", b["author"]["display_name"], "| avatar:", b["author"]["avatar_emoji"],
              "| status:", b["author"]["status"])
        print("REPLY_TO", b.get("reply_to"), "| QUOTE", (b.get("reply") or {}).get("content", "")[:60])
        print("TEXT", b["content"][:400])
        break
else:
    print("NO BOT REPLY after 70s")
