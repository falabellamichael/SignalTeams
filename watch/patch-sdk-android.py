#!/usr/bin/env python3
"""Patch liblemonade_nexus_sdk.so for Android: neuter OPENSSL_issetugid().

Why: the SDK's httplib clients call SSL_CTX_set_default_verify_paths(), which
reads the CA bundle via OpenSSL's ossl_safe_getenv("SSL_CERT_FILE"). On Android
apps the kernel sets AT_SECURE=1 (untrusted_app SELinux domain), so
OPENSSL_issetugid() returns 1 and ossl_safe_getenv() returns NULL for every env
var. The default cert path then falls back to the compiled /etc/ssl/cert.pem,
which does not exist -> no CA loaded -> every Tier-1/mesh TLS verify fails with
the generic "server unreachable". Patching OPENSSL_issetugid to return 0 makes
ossl_safe_getenv behave like getenv(), so SSL_CERT_FILE is honored.

This is a workaround for an upstream SDK portability bug; re-derive offsets if
the pinned SDK .so changes (the script verifies expected bytes first and
refuses to patch a mismatched build).

Offsets are file offsets == vaddrs (first PT_LOAD has offset==vaddr).
"""
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
JNI = os.path.join(ROOT, "app", "src", "main", "jniLibs")

# (abi, file_offset, original_bytes_hex, patch_bytes_hex)
PATCHES = [
    # x86_64: push rax; mov edi,0x17(AT_SECURE); call getauxval; ...  -> xor eax,eax; ret
    ("x86_64", 0x651D70,
     "50bf17000000e885", "31c0c3"),
    # arm64-v8a: stp/mov w0,#0x17; bl getauxval; cmp; cset; ldp; ret -> mov w0,#0; ret
    ("arm64-v8a", 0x681B24,
     "fd7bbfa9fd030091", "00008052c0035fd6"),
    # armeabi-v7a: push{r11,lr}; mov r11,sp; mov r0,#23; bl getauxval; ... -> mov r0,#0; bx lr
    ("armeabi-v7a", 0x405D94,
     "00482de90db0a0e1", "0000a0e31eff2fe1"),
]


def main():
    ok = True
    for abi, off, orig_hex, patch_hex in PATCHES:
        path = os.path.join(JNI, abi, "liblemonade_nexus_sdk.so")
        if not os.path.exists(path):
            print(f"[skip] {abi}: {path} not found")
            continue
        orig = bytes.fromhex(orig_hex)
        patch = bytes.fromhex(patch_hex)
        with open(path, "r+b") as f:
            f.seek(off)
            cur = f.read(len(orig))
            if cur[:len(patch)] == patch:
                print(f"[ok]   {abi}: already patched")
                continue
            if cur != orig:
                print(f"[FAIL] {abi}: bytes at 0x{off:x} = {cur.hex()}, expected {orig_hex}")
                print("       SDK .so likely changed; re-derive OPENSSL_issetugid offset.")
                ok = False
                continue
            f.seek(off)
            f.write(patch)
            f.seek(off)
            verify = f.read(len(patch))
            if verify != patch:
                print(f"[FAIL] {abi}: patch verify mismatch")
                ok = False
                continue
            print(f"[ok]   {abi}: patched OPENSSL_issetugid @0x{off:x}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
