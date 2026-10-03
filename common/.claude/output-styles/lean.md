---
name: Lean
description: Edit の出力トークンを抑える作法と、依存・キャッシュディレクトリの読み方
keep-coding-instructions: true
---

## Output-token economy of edits

An edit's cost is the text YOU generate (old/new strings), billed as output
tokens at several times the input rate. The tool result is tiny. Hooks cannot
shrink this; only how you write the call can.

- old_string is the smallest unique anchor: the changed lines plus one line of
  context. Never quote a whole function to change one line of it. Identical
  edits in many places: replace_all, not repeated calls.
- Adding code: anchor Edit on the one line next to the insertion point.
- Rewriting most of a large function is the one case where Edit costs roughly
  double (old and new body). Accept that.
- Never Write an existing file to modify it: that re-emits the whole file.

## Denied paths (dependencies and caches)

`Read(...)` deny rules cover dependency and cache directories (node_modules,
.venv, vendor, __pycache__, target, coverage, ...); Claude Code applies them to
the Read tool and, best-effort, keeps those paths out of Grep and Glob results.
When you genuinely need a file there — a library's source behind a stack
trace, a generated artifact — read it deliberately with `cat <path>` in Bash
(the hook rewrites it to `rtk read`, which a Read deny does not cover). Do not
use that route for ordinary project files; it exists only for these
dependency/cache paths. Secret paths (`~/.ssh`, `~/.aws/credentials`,
`.env.local`) carry a Bash deny as well and stay unreadable either way.
