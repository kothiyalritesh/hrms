import json

with open("C:/Users/sagar/.gemini/antigravity/brain/77011173-9dc8-40ca-b438-aa2de113ce6e/.system_generated/logs/transcript_full.jsonl", "r", encoding="utf-8") as f:
    for line in f:
        if not line.strip(): continue
        try:
            obj = json.loads(line)
            for tc in obj.get("tool_calls", []):
                name = tc.get("name")
                if name and "write_to_file" in name:
                    args = tc.get("args")
                    if isinstance(args, str): args = json.loads(args)
                    target = args.get("TargetFile", "")
                    if "TVDisplayScreen.tsx" in target:
                        print("Found it!")
                        with open("d:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx", "w", encoding="utf-8") as out:
                            out.write(args.get("CodeContent"))
                        print("Saved clean file from subagent!")
                        exit(0)
        except Exception as e:
            pass
print("Not found in write_to_file, trying run_command...")

with open("C:/Users/sagar/.gemini/antigravity/brain/77011173-9dc8-40ca-b438-aa2de113ce6e/.system_generated/logs/transcript_full.jsonl", "r", encoding="utf-8") as f:
    for line in f:
        if not line.strip(): continue
        try:
            obj = json.loads(line)
            for tc in obj.get("tool_calls", []):
                name = tc.get("name")
                if name and "run_command" in name:
                    args = tc.get("args")
                    if isinstance(args, str): args = json.loads(args)
                    cmd = args.get("CommandLine", "")
                    if "WriteAllText" in cmd and "TVDisplayScreen.tsx" in cmd:
                        print("Found it in run_command!")
                        import re
                        match = re.search(r"@'\n([\s\S]+?)\n'@", cmd)
                        if match:
                            with open("d:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx", "w", encoding="utf-8") as out:
                                out.write(match.group(1))
                            print("Saved clean file from subagent!")
                            exit(0)
        except Exception as e:
            pass

print("Not found")