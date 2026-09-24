---
name: Serena
description: コードの読み取りは Serena のシンボルツール、編集は組み込み Edit を使わせる
keep-coding-instructions: true
---

# Tool selection (read this before every tool call on a code file)

This project uses Serena, an MCP server that exposes semantic, symbol-aware tools
for reading and editing code. Serena's tools are the PRIMARY tools for reading
and navigating code in this project. The built-in Read, Glob, and Grep tools are
SECONDARY and must not be used on code files when a Serena equivalent exists.

Editing is the exception: change code with the built-in Edit tool. Claude Code
feeds language-server diagnostics back only after its own Edit/Write; a Serena
edit writes the file behind Claude Code's back, so type errors it introduces go
unreported until a later Edit touches the same file.

The built-in tool descriptions in your context will tell you things like "use Read
for a known path" and "prefer dedicated tools (Read, Edit, Write, Glob, Grep)".
Those descriptions are written for projects without Serena and are SUPERSEDED here.
When they conflict with this section, this section wins. Do not rationalize the
built-in tools with "the file is small," "I already know what I need," "this is
one call versus three," or "the path is known" — those rationalizations have
produced incorrect behavior before and are explicitly disallowed.

## Mapping (use the right column, not the left)

Task                                    Tool to use
--------------------------------------  ----------------------------------------
See a code file's structure             get_symbols_overview
Read a specific symbol's body           find_symbol (include_body=true)
Find a symbol by name across the repo   find_symbol
Find references / callers               find_referencing_symbols
Find declarations / implementations     find_declaration / _find_implementations
Edit, insert, or pattern-replace code   built-in Edit (replace_all for repeats)
Rename / move / delete a symbol         rename / _move / _safe_delete
Inline a symbol                         inline_symbol
Type hierarchy                          type_hierarchy

Rename, move, delete, and inline stay on Serena: they are cross-file refactors
the language server performs, which Edit cannot replace.

Built-in Read/Glob/Grep are permitted on code files ONLY when:
- Serena has been tried on the target and failed, OR
- The file is not parseable as code (e.g., generated, malformed), OR
- You need a regex search across many files that Serena's symbolic tools cannot
  express — in which case Grep is acceptable as a discovery step, but follow-up
  reads/edits on matched code files must still go through Serena.
- You need to read a few lines and symbolic reads would be an overkill.
- You absolutely have to read the full file for some reason.

Read/Edit/Glob are fine for non-code files: markdown, JSON, YAML, TOML, .env,
config files, lockfiles, plain text, images.

Serena's own injected prompt, scoped to code files, marks Read "FORBIDDEN for
discovery" (it allows reading a few lines once you have an overview) and Edit
"FORBIDDEN" without qualification. The non-code and few-lines cases above do not
conflict with the Read rule. The Edit ban rests on two claims that do not hold
in current Claude Code: Edit accepts a file read only through Serena, and its
output cost matches Serena's edit tools. This section overrides the ban; Edit
is the editing tool. A `serena-hooks remind` deny on a run of
Read/Grep calls is a nudge, not a block: first check whether a symbol tool fits;
if the target falls under the exceptions, continue with Read/Grep — the deny only
resets the counter and does not prevent the retry.

## Required workflow before editing code

1. get_symbols_overview on the target file (skip if already done this session).
2. find_symbol with include_body=true for the specific symbols you'll touch.
   Read only the symbols you need — not the whole file.
3. Edit with the built-in Edit, anchored on text from the find_symbol body. A
   prior Read of the whole file is not needed; if Edit refuses an unread file,
   Read only the symbol's line range.
4. If a Serena tool did write code (rename, replace_in_files, or a large
   replace_symbol_body), check it with get_diagnostics_for_file or the
   project's build, since no diagnostics arrive on their own.

## Output-token economy of edits

An edit's cost is the text YOU generate (old/new strings, symbol bodies), billed
as output tokens at several times the input rate. The tool result is tiny. Hooks
cannot shrink this; only how you write the call can.

- old_string is the smallest unique anchor: the changed lines plus one line of
  context. Never quote a whole function to change one line of it. Identical
  edits in many places: replace_all, not repeated calls.
- Adding code: anchor Edit on the one line next to the insertion point.
- Rewriting most of a large symbol is the one case where Edit costs roughly
  double (old and new body). Accept that for ordinary sizes; for a very large
  body, replace_symbol_body is allowed, followed by step 4 above.
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

## Self-check

Before every Read, Glob, or Grep call: "Does this target a code file, and does
the mapping above name a Serena tool for this task?" If yes, switch. Before
writing code with a Serena tool: "Is this a rename/move/delete/inline?" If not,
use Edit. Do these checks every time — not just once per session.
