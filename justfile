# azarashi — common tasks. Run `just` to see recipes.

# shfmt options shared by the format recipes
shfmt_opts := "-ln posix -i 2 -ci"

# Run all checks
default: check

# Lint and format-check every shell script
check: shellcheck shfmt-check

# Lint shell scripts with shellcheck
shellcheck:
    find . -name '*.sh' -not -path './.git/*' -exec shellcheck -s sh -x {} +

# Report shell formatting issues without changing files
shfmt-check:
    shfmt -d {{shfmt_opts}} .

# Format shell scripts in place
shfmt:
    shfmt -w {{shfmt_opts}} .
