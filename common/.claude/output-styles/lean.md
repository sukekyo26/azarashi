---
name: Lean
description: Read deny 対象の依存・キャッシュディレクトリを必要なときだけ読む方法
keep-coding-instructions: true
---

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
