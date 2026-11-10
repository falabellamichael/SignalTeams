import re

src = open(r"D:\AgentHive\watch\app\src\main\kotlin\dev\agenthive\watch\device\DeviceCommands.kt", encoding="utf-8").read()
pats = []
for m in re.finditer(r'Regex\(\s*"((?:[^"\\]|\\.)+)"\s*\)\s*(?:\r?\n\s*)?\.find\(t\)', src):
    raw = m.group(1)
    # unescape Kotlin escapes: \\b -> \b, \\s -> \s, \" -> "
    p = raw.replace('\\\\', '\x00').replace('\\"', '"').replace('\x00', '\\')
    pats.append((m.start(), p))
pats.sort()
print(f"{len(pats)} regexes")

tests = {
    "what's playing on my phone": "phonePlaying",
    "what's this song on my phone": "music-id",
    "what's playing": "localPlaying",
    "pause on my phone": "phoneMedia",
    "next track on my phone": "phoneMedia",
    "pause the music": "localMedia",
    "find my phone": "findPhone",
    "stop my phone alarm": "stopPhone",
    "open spotify on my phone": "phoneIntent",
    "open spotify": "openApp",
    "call mom on my phone": "phoneCall",
    "call mom": "localCall",
    "start a run": "workout",
    "battery": "battery",
    "what's my phone battery": "phoneBatt",
    "clear my notifications": "clearNotif",
    "read my phone's notifications": "phoneNotif",
    "what song is playing on my phone": "music-id-or-playing",
    "put my phone on silent": "ringer",
    "turn my phone torch on": "torch",
    "remind me to call mom when i get to work": "geo",
    "what's the weather": "weather",
    "how fast am i going": "speed",
    "where am i": "whereami",
    "what's my heart rate": "hr",
    "stop the music": "localMediaStop",
    "stop the ringing": "stopPhone",
    "found it": "stopPhone",
    "vibrate": "vibrate",
    "what time is it in tokyo": "citytime",
}
compiled = [(i, p, re.compile(p)) for i, p in pats]
for t, want in tests.items():
    t2 = t.lower().strip().rstrip('.!?')
    hit = next((p for i, p, c in compiled if c.search(t2)), None)
    tag = "NOMATCH!" if not hit else hit[:95]
    print(f"{want:>22} <- {t!r}:\n{'':>24}{tag}")
