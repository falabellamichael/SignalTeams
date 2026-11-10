"""Fetch the lemonade-nexus SDK shared library for this platform.

    backend/.venv/Scripts/python.exe backend/nexus/fetch.py [version]

Version defaults to the pinned NEXUS_SDK_VER below (a dated lemonade-nexus
release tag). Windows has no standalone DLL asset — the script pulls
lemonade_nexus_sdk.dll out of the nexus-client zip. Linux ships a bare .so;
Darwin a bare .dylib. Output lands in backend/nexus/bin/.
"""
import io
import json
import os
import platform
import sys
import urllib.request
import zipfile

NEXUS_SDK_VER = "2026.11.08.2"
HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.join(HERE, "bin")

ASSETS = {
    "windows": ("nexus-client-windows-v{v}.zip", "lemonade_nexus_sdk.dll",
                "lemonade_nexus_sdk.dll"),
    "linux": ("lemonade-nexus-sdk-v{v}-linux-x86_64-liblemonade_nexus_sdk.so",
              None, "liblemonade_nexus_sdk.so"),
    "darwin": ("lemonade-nexus-sdk-v{v}-darwin-arm64-liblemonade_nexus_sdk.dylib",
               None, "liblemonade_nexus_sdk.dylib"),
}


def main():
    ver = sys.argv[1] if len(sys.argv) > 1 else NEXUS_SDK_VER
    plat = {"Windows": "windows", "Linux": "linux", "Darwin": "darwin"}[platform.system()]
    asset, member, out_name = ASSETS[plat]
    url = ("https://github.com/lemonade-sdk/lemonade-nexus/releases/download/"
           f"v{ver}/" + asset.format(v=ver))
    print(f"downloading {url}")
    data = urllib.request.urlopen(url, timeout=120).read()
    os.makedirs(BIN, exist_ok=True)
    out = os.path.join(BIN, out_name)
    if member:  # zip asset — extract just the SDK
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            payload = z.read(member)
    else:
        payload = data
    with open(out, "wb") as f:
        f.write(payload)
    print(f"wrote {out} ({len(payload) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
