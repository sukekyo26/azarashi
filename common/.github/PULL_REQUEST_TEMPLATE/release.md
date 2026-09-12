<!--
Release PR: develop → main. Authored by the version-bump / pr-create skills, not by hand.
Title MUST match the release commit on develop (Conventional Commits, e.g. `chore: release vX.Y.Z`).

Normal feature / fix PRs use the default pull_request_template.md instead.
-->

## Release

`vA.B.C` → `vX.Y.Z`
<!-- semver bump: major / minor / patch — and why (Added → minor; Fixed/Changed/Removed only → patch). -->

## Released changes
<!-- Mirror, verbatim, the `## [X.Y.Z]` section just added to the CHANGELOG (every locale the project keeps).
     Keep only the categories that actually have entries; delete the empty ones. -->

### Added
-

### Changed
-

### Fixed
-

### Removed
-

## Breaking changes
<!-- pre-1.0 minor bumps may still break. List each BREAKING entry and its migration path
     (config key / flag / API surface + the rewrite users follow), or write "None". -->
None

## Release checklist
- [ ] Every version marker bumped to `X.Y.Z` in lockstep (`VERSION`, package metadata, embedded constants)
- [ ] `## [X.Y.Z] - YYYY-MM-DD` added to the CHANGELOG in every locale; `[Unreleased]` left in place but empty; compare links updated
- [ ] `[Unreleased]` reviewed against the net diff — counterbalanced / out-of-scope entries removed (changelog skill)
- [ ] CI is green
- [ ] (when applicable) The release automation triggered by this merge (tag, artifacts, publish) has its preconditions met
