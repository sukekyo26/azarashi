# dotfiles — common tasks. Run `just` to see recipes.

# shfmt options shared by the format recipes
shfmt_opts_posix := "-ln posix -i 2 -ci"
shfmt_opts_bash := "-i 2 -ci"

# Run all checks
default: check

# Lint and format-check every shell script
check: shellcheck-posix shellcheck-bash shfmt-check

# Run the full local suite (lint + format + unit tests) — mirrors CI
ci: check test

# Lint install.sh, its sourced lib/, and the POSIX test runner as POSIX sh
shellcheck-posix:
    shellcheck -s sh -x install.sh lib/*.sh test/*.sh

# Lint the remaining (bash) scripts using their declared shebang
shellcheck-bash:
    find . -name '*.sh' \
      -not -path './.git/*' \
      -not -path './install.sh' \
      -not -path './lib/*' \
      -not -path './test/*' \
      -exec shellcheck -x {} +

# Report shell formatting issues without changing files
shfmt-check:
    shfmt -d {{shfmt_opts_posix}} install.sh lib/ test/
    shfmt -d {{shfmt_opts_bash}} common

# Format shell scripts in place
shfmt:
    shfmt -w {{shfmt_opts_posix}} install.sh lib/ test/
    shfmt -w {{shfmt_opts_bash}} common

# Run the library unit tests (depends only on jq)
test:
    sh test/run.sh

# Install pre-commit hooks into .git/hooks/ (one-time setup)
hooks-install:
    pre-commit install --install-hooks

# Run every pre-commit hook against every tracked file
hooks-run:
    pre-commit run --all-files

# Full git history secret scan (mirrors CI)
gitleaks-scan:
    gitleaks git --no-banner --redact --verbose
