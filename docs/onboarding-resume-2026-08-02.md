# PAUSE POINT · 2026-08-02 ~02:1x local — 30minnt + BEMA onboarding

Wifi transport pause. Everything below is committed or cloud-side; nothing
in-flight on this machine.

## Where things stand
- Code: quire tree at c8ecf69+1 (tensor-leak fix committed after it; `git log
  pipelines/transcription` tells the story: 9603dea fetch verify, 822f750
  lazy cutting + verified decode, c8ecf69 per-chunk cache, then the
  hypothesis-strip fix).
- Transcripts local: 30minnt 460/462 · bema 447/513 full-length; the 66
  redo episodes are PURGED locally and on asr-transcripts (audio cached good
  on asr-audio). /tmp/short-list.txt is the authoritative 66 list
  (also copied to docs/onboarding-shortlist-2026-08-02.txt).
- REDO5 RUNS DETACHED ON MODAL with the hypothesis-strip fix — survives
  this laptop offline:
  - 30minnt: modal.com/apps/founder-28840/main/ap-z2XE5rnw4y4BcxQ5J6RMsg
  - bema:    modal.com/apps/founder-28840/main/ap-QfRSjxR4LON7VtkaUXjP6g
- Codex extraction: STOPPED CLEANLY (ledger-based resume; nothing lost).
  30minnt read 462/462 (5,615 rows, canonical out on /Volumes/External).
  bema read ~320+/513 (ledger was wiped once by the --only --restart
  footgun — see podcast-extraction-conventions memory — cycle was
  rebuilding it; rows and ledger agree with each other).

## To resume (in order)
1. `cd ~/dev/scripture-app-quire && for s in thirty-minutes-nt bema; do
   node pipelines/transcription/pull_transcripts.mjs --source $s; done`
2. Verify the 66: every key in docs/onboarding-shortlist-2026-08-02.txt
   present with lastWordEnd/audioSeconds ≥ 0.95. If still short, the OOM
   hunt continues (next suspect: per-chunk RSS in NeMo itself; consider
   smaller CHUNK_SECONDS for >75-min episodes).
3. Surgically un-read the 66 (they hold truncated-era refs):
   `python3 <scratchpad>/unread-episodes.py /Volumes/External/Transcripts/codex-refs-<s>.jsonl /Volumes/External/Transcripts/codex-refs-<s>.read-log.json docs/onboarding-shortlist-2026-08-02.txt`
   (script copied to scripts/unread-episodes.py in this commit).
4. Extraction until dry, both sources (NEVER --restart):
   `node --import tsx scripts/extract-refs-codex.ts --source <s> --episodes 600 --concurrency 12 --timeout-minutes 12 --out /Volumes/External/Transcripts/codex-refs-<s>.jsonl`
5. Install + index (runbook §5–6 in onboarding-a-podcast.md):
   install-references.ts --from a cat of the canonical set incl. the two new
   files, then index-transcripts.ts, verify-transcript-index.ts, and the
   passage-index rebuild.
6. Legacy corpus: 38 truncated episodes chip (task_b082f523) — after the two
   new shows land.
