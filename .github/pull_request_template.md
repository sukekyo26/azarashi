<!--
PR title must follow Conventional Commits: feat(scope): ... / fix(scope): ... / chore: ... etc.
Release PRs (develop → main) may use `chore: release vX.Y.Z`.
-->

## Summary
<!-- 1–2 sentences on the why: what problem this solves, what triggered the change -->


## Type of change
<!-- Tick every applicable box. Aligns with Conventional Commits prefixes. -->
- [ ] ✨ New feature (feat)
- [ ] 🐛 Bug fix (fix)
- [ ] 💥 Breaking change (BREAKING)
- [ ] 🔒 Security fix (security)
- [ ] ⚡ Performance improvement (perf)
- [ ] ♻️ Refactor (refactor)
- [ ] 📝 Docs (docs)
- [ ] ✅ Tests (test)
- [ ] 🔧 Build / CI / chore (chore)

## Changes
<!-- Bullet list of the main changes — externally-visible diff, not implementation detail -->
-
-

## Related issues
<!-- Closes #N / Refs #N. Use "None" if there isn't one. -->
None

## Breaking change details
<!-- Only when 💥 is ticked above: describe the config-format change, dropped option, or migration steps. Use "None" otherwise. -->
None

## Test plan
- [ ] `just ci` is green locally
- [ ] (when applicable) E2E workflow (`.github/workflows/e2e.yml`) is green, or `cocoon init && cocoon gen && docker compose ...` round-trip verified manually
- [ ] (when applicable) Affected plugins / CLI subcommands exercised manually

## CHANGELOG
<!-- Rule of thumb: does this change end-user or plugin-author behavior, config, or surface? If no, mark it out-of-scope. -->
- [ ] Updated the `[Unreleased]` section of both `CHANGELOG.md` and `docs/CHANGELOG.ja.md`
- [ ] Out of CHANGELOG scope (tests / CI / refactor / lint config / etc.)
