import re

path = r"D:\AgentHive\watch\app\src\main\kotlin\dev\agenthive\watch\device\DeviceCommands.kt"
src = open(path, encoding="utf-8").read()

pat = re.compile(r'Regex\("((?:[^"\\]|\\.)*)"\)')
seen = {}

def repl(m):
    lit = m.group(0)
    if lit not in seen:
        seen[lit] = "RX%02d" % (len(seen) + 1)
    return seen[lit]

new = pat.sub(repl, src)
vals = "\n".join("    private val %s = %s" % (name, lit) for lit, name in seen.items())
new = new.replace("object DeviceCommands {", "object DeviceCommands {\n" + vals + "\n", 1)
open(path, "w", encoding="utf-8").write(new)
print("hoisted %d patterns" % len(seen))
