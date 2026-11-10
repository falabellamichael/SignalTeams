import re

pat = re.compile(r'`([^`]+)`|\|\|(.+?)\|\||\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*]+)\*|@(\w+)')
s = "@MichaelAnthony No ... What I *can* do:\n- **Work a local repo** in the workspace (D:\\AgentHive) via `run_command`"

for m in pat.finditer(s):
    print("Match:", repr(m.group(0)))
    print("  groups:", [(i, m.group(i)) for i in range(1, len(m.groups()) + 1) if m.group(i) is not None])
