import ctypes, json, os, time
DLL = r"D:\AgentHive\backend\nexus\bin\lemonade_nexus_sdk.dll"
DATA = r"D:\AgentHive\backend\nexus\peerdata"
ln = ctypes.CDLL(DLL)
CP = ctypes.POINTER(ctypes.c_char_p); VP = ctypes.c_void_p
ln.ln_free.argtypes = [VP]; ln.ln_free.restype = None
ln.ln_create_tls.argtypes = [ctypes.c_char_p, ctypes.c_uint16]; ln.ln_create_tls.restype = VP
ln.ln_destroy.argtypes = [VP]
ln.ln_health.argtypes = [VP, CP]
ln.ln_set_genesis_key.argtypes = [VP, ctypes.c_char_p, ctypes.c_uint64]
ln.ln_discover_servers.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint16, CP]
ln.ln_identity_load.argtypes = [ctypes.c_char_p]; ln.ln_identity_load.restype = VP
ln.ln_identity_destroy.argtypes = [VP]
ln.ln_set_identity.argtypes = [VP, VP]
ln.ln_join_network.argtypes = [VP, ctypes.c_char_p, ctypes.c_char_p, CP]
ln.ln_leave_network.argtypes = [VP, CP]

def jcall(fn, *args):
    out = ctypes.c_char_p()
    rc = fn(*args, ctypes.byref(out))
    s = out.value.decode() if out.value else None
    if out.value: ln.ln_free(out)
    return rc, s

rc, s = jcall(ln.ln_discover_servers, b"lemonade-nexus.io", b"us-west", 9100)
cli = None
for cand in json.loads(s)["servers"]:
    c = ln.ln_create_tls(cand["host"].encode(), cand["port"])
    rc2, s2 = jcall(ln.ln_health, c)
    if rc2 == 0:
        cli = c; break
    ln.ln_destroy(c)
assert cli
ln.ln_set_genesis_key(cli, b"W7xnOjHqav3coRGGAxo5X8DWeE9AnOZee2mlzCxt4Ic=", 0)
ident = ln.ln_identity_load(os.path.join(DATA, "identity.json").encode())
assert ident, "no peer identity"
ln.ln_set_identity(cli, ident)
rc, s = jcall(ln.ln_join_network, cli, b"", b"")
print("join:", s[:200])
rc, s = jcall(ln.ln_leave_network, cli)
print("leave:", s)
ln.ln_destroy(cli); ln.ln_identity_destroy(ident)
