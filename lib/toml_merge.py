#!/usr/bin/env python3
"""TOML <-> JSON bridge for the fragment merge, on a vendored tomlkit so the
write stays comment- and format-preserving. Two modes:

  to-json <file>           parse TOML, print compact JSON (the jq merge brain
                           runs on JSON; nonzero exit on a parse error)
  apply <orig|-> <t> <m>   print merged TOML: load the original document <orig>
                           ('-' = none, build fresh) and apply only the diff
                           between target-JSON <t> and merged-JSON <m>, so the
                           comments and formatting of untouched keys survive

Codex writes table headers with unquoted '/' in path keys (e.g.
[projects./home/u/x]) -- invalid TOML every spec parser rejects. We quote such
segments before parsing and unquote them again on output, so the file round-
trips byte-for-byte and the merge is not skipped on real codex configs.
"""

import datetime
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor"))
import tomlkit  # noqa: E402

# A bare key per the TOML spec is [A-Za-z0-9_-]+. Header segments outside that
# (codex's '/' paths) must be quoted to parse.
_BARE = re.compile(r"^[A-Za-z0-9_-]+$")
_HEADER = re.compile(r"^(\s*\[\[?)([^\]]*)(\]\]?[^\n]*\n?)$")
_MISSING = object()


def _quote_headers(text):
    """Quote the first invalid bare-key segment (and the rest of the path) in
    each table header, so codex's unquoted '/' paths parse."""
    out = []
    for line in text.splitlines(keepends=True):
        m = _HEADER.match(line)
        if not m or '"' in m.group(2) or "'" in m.group(2):
            out.append(line)
            continue
        open_, inner, close = m.groups()
        segs = inner.split(".")
        for i, seg in enumerate(segs):
            if not _BARE.match(seg):
                rest = ".".join(segs[i:]).replace('"', '\\"')
                segs = segs[:i] + ['"' + rest + '"']
                break
        out.append(open_ + ".".join(segs) + close)
    return "".join(out)


def _unquote_headers(text):
    """Inverse of _quote_headers: drop quotes around any '/'-bearing header
    segment, restoring codex's exact unquoted representation."""
    def fix(m):
        open_, inner, close = m.groups()
        inner = re.sub(r'"([^"]*/[^"]*)"', lambda q: q.group(1), inner)
        return open_ + inner + close

    out = []
    for line in text.splitlines(keepends=True):
        out.append(_HEADER.sub(fix, line) if _HEADER.match(line) else line)
    return "".join(out)


def _json_default(o):
    if isinstance(o, (datetime.datetime, datetime.date, datetime.time)):
        return o.isoformat()
    raise TypeError(f"not JSON serializable: {type(o).__name__}")


def _is_table(v):
    return hasattr(v, "keys") and hasattr(v, "__setitem__")


def _apply(node, before, after):
    """Make `node` (a tomlkit table) hold `after`, using `before` to know what is
    unchanged. Unchanged subtrees are left untouched so their formatting and
    comments -- and codex's lossy-to-JSON keys -- survive verbatim."""
    for key, av in after.items():
        bv = before.get(key, _MISSING) if isinstance(before, dict) else _MISSING
        if bv is not _MISSING and bv == av:
            continue
        if isinstance(av, dict):
            if isinstance(bv, dict) and key in node and _is_table(node[key]):
                _apply(node[key], bv, av)
            else:
                table = tomlkit.table()
                _apply(table, {}, av)
                node[key] = table
        else:
            node[key] = av
    if isinstance(before, dict):
        for key in list(before.keys()):
            if key not in after and key in node:
                del node[key]


def _load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def cmd_to_json(path):
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    doc = tomlkit.parse(_quote_headers(text))
    json.dump(doc.unwrap(), sys.stdout, default=_json_default)


def cmd_apply(orig, target_json, merged_json):
    before = _load_json(target_json) if target_json != "-" else {}
    after = _load_json(merged_json)
    if orig != "-" and os.path.exists(orig):
        with open(orig, encoding="utf-8") as fh:
            doc = tomlkit.parse(_quote_headers(fh.read()))
    else:
        doc = tomlkit.document()
    _apply(doc, before, after)
    sys.stdout.write(_unquote_headers(tomlkit.dumps(doc)))


def main(argv):
    if len(argv) >= 3 and argv[1] == "to-json":
        cmd_to_json(argv[2])
    elif len(argv) >= 5 and argv[1] == "apply":
        cmd_apply(argv[2], argv[3], argv[4])
    else:
        sys.stderr.write("usage: toml_merge.py (to-json <file> | apply <orig|-> <target.json> <merged.json>)\n")
        return 2
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except tomlkit.exceptions.TOMLKitError as exc:
        sys.stderr.write(f"TOML error: {exc}\n")
        sys.exit(1)
