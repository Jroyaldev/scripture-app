#!/usr/bin/env python3
"""Surgically remove named recordIds from a codex-refs jsonl + read-log so a
plain --only (or the normal cycle) re-reads exactly them."""
import json, sys
jsonl, ledger, listfile = sys.argv[1:4]
keys={l.strip().replace('__',':',2) for l in open(listfile) if l.strip()}
rows=[l for l in open(jsonl) if l.strip() and json.loads(l).get('recordId') not in keys]
open(jsonl,'w').writelines(rows)
d=json.load(open(ledger))
before=len(d.get('episodes',[]))
d['episodes']=[e for e in d['episodes'] if e not in keys]
json.dump(d,open(ledger,'w'))
print(f"rows kept {len(rows)}; ledger {before}→{len(d['episodes'])}")
