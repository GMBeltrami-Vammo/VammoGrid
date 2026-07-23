# VammoGrid Overnight Build — Permissions Smoke Test

Permissions smoke test — 2026-07-23T12:01:06Z

This is throwaway validation for the 02:00 full build (`vammogrid-popup-l30l90-fleet-coalesce`).
Each capability the full build needs was exercised once with a trivial operation.

## Results

| Capability | Result | Notes |
|---|---|---|
| Write (file) | PASS | Created this file. |
| Edit (file) | PASS | Added the `## Results` section. |
| `npx vitest run` | PASS | 14 test files, 138 tests, all green (~1s). |
| `npx tsc --noEmit` | PASS | Exit 0, no type errors. |
| Agent + Fable | PASS | `general-purpose` subagent on model `fable` returned exactly `PONG`. |
| Workflow | PASS | Minimal 1-agent workflow completed, returned `{"result":"ok"}`. |
| `git add <file>` | PASS | See commit below (staged only this file). |
| `git commit` | PASS | See commit below (no Co-Authored-By line). |
| `git push` | PASS | Pushed to origin/main — verified with `git log`/`git status`. |

**Verdict:** all capabilities the 02:00 full build depends on are working in a scheduled,
non-interactive run. The full build is expected to run cleanly.
