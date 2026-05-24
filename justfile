# azarashi — common tasks. Run `just` to see recipes.

# shfmt options shared by the format recipes
shfmt_opts_posix := "-ln posix -i 2 -ci"
shfmt_opts_bash := "-i 2 -ci"

# Run all checks
default: check

# Lint and format-check every shell script
check: shellcheck-posix shellcheck-bash shfmt-check

# Lint install.sh and its sourced lib/ as POSIX sh
shellcheck-posix:
    shellcheck -s sh -x install.sh lib/*.sh

# Lint the remaining (bash) scripts using their declared shebang
shellcheck-bash:
    find . -name '*.sh' \
      -not -path './.git/*' \
      -not -path './install.sh' \
      -not -path './lib/*' \
      -exec shellcheck -x {} +

# Report shell formatting issues without changing files
shfmt-check:
    shfmt -d {{shfmt_opts_posix}} install.sh lib/
    shfmt -d {{shfmt_opts_bash}} .devcontainer home

# Format shell scripts in place
shfmt:
    shfmt -w {{shfmt_opts_posix}} install.sh lib/
    shfmt -w {{shfmt_opts_bash}} .devcontainer home
