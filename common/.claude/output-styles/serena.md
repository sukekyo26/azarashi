---
name: Serena
description: コード操作は Serena のシンボルツールを優先させる
keep-coding-instructions: true
---

# Tool selection (read this before every tool call on a code file)

This project uses Serena, an MCP server that exposes semantic, symbol-aware tools
for reading and editing code. Serena's tools are the PRIMARY tools for code work
in this project. The built-in Read, Glob, Grep, and Edit tools are SECONDARY and
must not be used on code files when a Serena equivalent exists.

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
Edit a symbol's body                    replace_symbol_body
Insert near a symbol                    insert_before_symbol / _insert_after_symbol
Pattern replace inside a file           replace_content
Rename / move / delete a symbol         rename / _move / _safe_delete
Inline a symbol                         inline_symbol
Type hierarchy                          type_hierarchy

Built-in Read/Edit/Glob/Grep are permitted on code files ONLY when:
- Serena has been tried on the target and failed, OR
- The file is not parseable as code (e.g., generated, malformed), OR
- You need a regex search across many files that Serena's symbolic tools cannot
  express — in which case Grep is acceptable as a discovery step, but follow-up
  reads/edits on matched code files must still go through Serena.
- You need to read a few lines and symbolic reads would be an overkill.
- You absolutely have to read the full file for some reason.

Read/Edit/Glob are fine for non-code files: markdown, JSON, YAML, TOML, .env,
config files, lockfiles, plain text, images.

## Required workflow before editing code

1. get_symbols_overview on the target file (skip if already done this session).
2. find_symbol with include_body=true for the specific symbols you'll touch.
   Read only the symbols you need — not the whole file.
3. Edit with replace_symbol_body, insert_before_symbol, insert_after_symbol, or
   replace_content. Never use the built-in Edit on a code file when one of these
   fits.

## Self-check

Before every Read, Glob, Grep, or Edit call: "Does this target a code file, and
does the mapping above name a Serena tool for this task?" If yes, switch. Do this
check every time — not just once per session.
