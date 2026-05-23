# syntax=docker/dockerfile:1.7
# Auto-generated from workspace.toml — do not edit directly.
ARG IMAGE=node
ARG IMAGE_VERSION=24-bookworm-slim
FROM ${IMAGE}:${IMAGE_VERSION}

ARG USERNAME

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    locales \
    sudo \
    zsh \
    zsh-autosuggestions \
    gnupg \
    unzip \
    git \
    xz-utils \
    zip \
    libglu1-mesa \
    clang \
    cmake \
    ninja-build \
    pkg-config \
    libgtk-3-dev \
    liblzma-dev \
    build-essential \
    vim \
    git \
    openssh-client \
    gnupg \
    tree \
    less \
    rsync \
    file \
    bc \
    wget \
    gettext-base \
    uuid-runtime \
    zip \
    unzip \
    xz-utils \
    tar \
    gzip \
    bzip2 \
    build-essential \
    pkg-config \
    make \
    patch \
    fzf \
    ripgrep \
    bat \
    fd-find \
    python3 \
    python3-pip \
    python3-venv \
    jq \
    yq \
    git-lfs \
    strace \
    tmux \
    && sed -i -E -e 's|^# *(en_US\.UTF-8 UTF-8)$|\1|' -e 's|^# *(ja_JP\.UTF-8 UTF-8)$|\1|' /etc/locale.gen \
    && locale-gen \
    && rm -rf /tmp/* /var/tmp/*

# The container user is created with a FIXED uid/gid (1000) so the committed
# .devcontainer/ stays host-independent; docker-entrypoint.sh remaps it to the
# host owner at container start. A base-image account already on 1000
# (e.g. ubuntu:24.04 ships 'ubuntu') is removed first.
RUN existing_user="$(getent passwd 1000 | cut -d: -f1)" && \
    if [ -n "$existing_user" ] && [ "$existing_user" != "${USERNAME}" ]; then \
        userdel -r "$existing_user" 2>/dev/null || true; \
    fi && \
    existing_group="$(getent group 1000 | cut -d: -f1)" && \
    if [ -n "$existing_group" ] && [ "$existing_group" != "${USERNAME}" ]; then \
        groupdel "$existing_group" 2>/dev/null || true; \
    fi && \
    groupadd -g 1000 ${USERNAME} && \
    useradd -m -s /usr/bin/zsh -u 1000 -g 1000 ${USERNAME} && \
    usermod -aG sudo ${USERNAME} && \
    echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME} && \
    chmod 0440 /etc/sudoers.d/${USERNAME}

USER ${USERNAME}
WORKDIR /home/${USERNAME}

# Set locale environment variables
ENV LANG=ja_JP.UTF-8
ENV LANGUAGE=ja_JP:en
ENV LC_ALL=ja_JP.UTF-8

# Inputs read by docker-entrypoint.sh, which remaps the fixed-uid user above
# to the host owner at container start.
ENV COCOON_USER=${USERNAME}
ENV COCOON_WORKSPACE="/home/tama/work"
ENV COCOON_BIND_PATHS="/home/tama/work:/home/tama/.claude.json"

# Ensure the active login shell's rc file exists before any later RUN
# (plugin install scripts, cert env exports, completion init) appends to it
# via >> "$RC_FILE". fish in particular keeps its config under
# ~/.config/fish/, a path useradd does not pre-create.
RUN mkdir -p "$(dirname "$HOME/.zshrc")" && touch "$HOME/.zshrc"

# Seed ~/.cocoon with placeholder rc files so the cocoon named volume
# (mounted at /home/${USERNAME}/.cocoon at runtime) inherits these comment
# headers on first start. Edits inside the container persist across
# 'docker compose down' + 'up --build' because the named volume keeps the
# writable layer; only 'down -v' resets it.
RUN mkdir -p "$HOME/.cocoon" && \
    printf '# cocoon: persisted shell rc (bash/zsh). Edit freely; survives container rebuild.\n' \
        > "$HOME/.cocoon/.shellrc" && \
    printf '# cocoon: persisted shell rc (fish). Edit freely; survives container rebuild.\n' \
        > "$HOME/.cocoon/.shellrc.fish"

# Enable zsh completion + autosuggestions
RUN echo 'autoload -Uz compinit && compinit' >> "$HOME/.zshrc" && \
    echo 'source /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh 2>/dev/null || true' >> "$HOME/.zshrc"

# Prepare volume mount directories with correct ownership
USER root
RUN mkdir -p /home/${USERNAME}/.aws /home/${USERNAME}/.cargo /home/${USERNAME}/.claude /home/${USERNAME}/.config /home/${USERNAME}/.copilot /home/${USERNAME}/.deno /home/${USERNAME}/.flutter /home/${USERNAME}/.pub-cache /home/${USERNAME}/.rustup /home/${USERNAME}/go && \
    chown ${USERNAME}:${USERNAME} /home/${USERNAME}/.aws /home/${USERNAME}/.cargo /home/${USERNAME}/.claude /home/${USERNAME}/.config /home/${USERNAME}/.copilot /home/${USERNAME}/.deno /home/${USERNAME}/.flutter /home/${USERNAME}/.pub-cache /home/${USERNAME}/.rustup /home/${USERNAME}/go
# Install Deno
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    RC_FILE="$HOME/.zshrc" RC_SYNTAX="posix" LOGIN_SHELL="zsh" COCOON_INSTALL_METHOD="binary" PIN="" CHECKSUM_AMD64="" CHECKSUM_ARM64="" bash <<'COCOON_PLUGIN_EOF'
#!/usr/bin/env bash
# Install Deno (https://github.com/denoland/deno)
#
# Inputs (env):
#   PIN              : Deno version without leading "v" (e.g. "2.7.14"); empty = latest stable
#   CHECKSUM_AMD64   : sha256 of x86_64-unknown-linux-gnu zip; empty to skip verification
#   CHECKSUM_ARM64   : sha256 of aarch64-unknown-linux-gnu zip; empty to skip verification
set -euo pipefail

# Yellow WARNING when stderr is a TTY (and NO_COLOR is unset) or
# FORCE_COLOR is set. NO_COLOR wins per no-color.org.
if [ -n "${NO_COLOR:-}" ]; then
  C_YEL=''
  C_RST=''
elif [ -n "${FORCE_COLOR:-}" ] || [ -t 2 ]; then
  C_YEL=$'\033[33m'
  C_RST=$'\033[0m'
else
  C_YEL=''
  C_RST=''
fi

ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
  amd64)
    DENO_ARCH="x86_64"
    CHECKSUM="$CHECKSUM_AMD64"
    ;;
  arm64)
    DENO_ARCH="aarch64"
    CHECKSUM="$CHECKSUM_ARM64"
    ;;
  *)
    DENO_ARCH="x86_64"
    CHECKSUM="$CHECKSUM_AMD64"
    ;;
esac

if [ -n "$PIN" ]; then
  VERSION_TAG="v${PIN}"
else
  # `releases/latest` redirects to the newest stable tag (e.g. v2.7.14).
  VERSION_TAG=$(curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
    -o /dev/null -w '%{url_effective}' https://github.com/denoland/deno/releases/latest |
    awk -F'/' '{print $NF}')
  if [ -z "$VERSION_TAG" ]; then
    echo "Failed to resolve latest Deno release tag" >&2
    exit 1
  fi
fi

curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
  "https://github.com/denoland/deno/releases/download/${VERSION_TAG}/deno-${DENO_ARCH}-unknown-linux-gnu.zip" -o /tmp/deno.zip

if [ -n "$CHECKSUM" ]; then
  echo "${CHECKSUM}  /tmp/deno.zip" | sha256sum -c -
else
  printf '%sWARNING: SHA256 verification skipped for Deno (no checksum for deno in [plugins.versions])%s\n' "$C_YEL" "$C_RST" >&2
fi

unzip -q -o /tmp/deno.zip -d /usr/local/bin
chmod 0755 /usr/local/bin/deno
rm /tmp/deno.zip
COCOON_PLUGIN_EOF
ENV DENO_DIR="/home/${USERNAME}/.deno"
# Install Docker Buildx
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    RC_FILE="$HOME/.zshrc" RC_SYNTAX="posix" LOGIN_SHELL="zsh" COCOON_INSTALL_METHOD="binary" PIN="" CHECKSUM_AMD64="" CHECKSUM_ARM64="" bash <<'COCOON_PLUGIN_EOF'
#!/usr/bin/env bash
# Install Docker Buildx (https://github.com/docker/buildx)
#
# Pair with the docker-cli plugin (or a docker-bundled base image) so the
# host Docker daemon is reachable; buildx is a client-side CLI plugin that
# drives the daemon's BuildKit, and is useless without one.
#
# Inputs (env):
#   PIN              : Buildx version without leading "v" (e.g. "0.24.0"); empty = latest
#   CHECKSUM_AMD64   : sha256 of the amd64 binary; empty to skip verification
#   CHECKSUM_ARM64   : sha256 of the arm64 binary; empty to skip verification
set -euo pipefail

# Yellow WARNING when stderr is a TTY (and NO_COLOR is unset) or
# FORCE_COLOR is set. NO_COLOR wins per no-color.org.
if [ -n "${NO_COLOR:-}" ]; then
  C_YEL=''
  C_RST=''
elif [ -n "${FORCE_COLOR:-}" ] || [ -t 2 ]; then
  C_YEL=$'\033[33m'
  C_RST=$'\033[0m'
else
  C_YEL=''
  C_RST=''
fi

ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
  amd64) CHECKSUM="$CHECKSUM_AMD64" ;;
  arm64) CHECKSUM="$CHECKSUM_ARM64" ;;
  *) CHECKSUM="$CHECKSUM_AMD64" ;;
esac

if [ -n "$PIN" ]; then
  VERSION="$PIN"
else
  VERSION=$(curl -fsSLI --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
    -o /dev/null -w '%{url_effective}' https://github.com/docker/buildx/releases/latest |
    sed 's|.*/tag/v||')
fi

curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
  "https://github.com/docker/buildx/releases/download/v${VERSION}/buildx-v${VERSION}.linux-${ARCH}" \
  -o /tmp/docker-buildx

if [ -n "$CHECKSUM" ]; then
  echo "${CHECKSUM}  /tmp/docker-buildx" | sha256sum -c -
else
  printf '%sWARNING: SHA256 verification skipped for Docker Buildx (no checksum for docker-buildx in [plugins.versions])%s\n' "$C_YEL" "$C_RST" >&2
fi

# /usr/libexec/docker/cli-plugins/ is the Docker CLI plugin lookup path
# (see `docker --help`). The directory may not exist on a fresh base image
# if the docker-cli plugin has not run yet, so create it before install.
mkdir -p /usr/libexec/docker/cli-plugins
install -o root -g root -m 0755 /tmp/docker-buildx /usr/libexec/docker/cli-plugins/docker-buildx
rm /tmp/docker-buildx
COCOON_PLUGIN_EOF
# Install Docker CLI
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    RC_FILE="$HOME/.zshrc" RC_SYNTAX="posix" LOGIN_SHELL="zsh" COCOON_INSTALL_METHOD="apt" bash <<'COCOON_PLUGIN_EOF'
#!/usr/bin/env bash
# Install Docker CLI (client only, to use host Docker daemon via socket mount)
# https://github.com/docker/cli
#
# This installs the CLI packages only. The container user's access to the
# mounted docker socket is configured at container start by
# docker-entrypoint.sh, which resolves the socket's GID and joins the user
# to a matching group.
set -euo pipefail

mkdir -p /etc/apt/keyrings

# shellcheck disable=SC1091
. /etc/os-release

# Docker publishes its apt repository at /linux/<distro> for both Ubuntu and
# Debian. Use the /etc/os-release ID directly so the same install.sh works
# for either base image without a hard-coded distro path.
docker_repo="https://download.docker.com/linux/${ID}"
curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
  "${docker_repo}/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] ${docker_repo} ${VERSION_CODENAME} stable" \
  >/etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin
apt-get clean
rm -rf /var/lib/apt/lists/* /var/tmp/*
COCOON_PLUGIN_EOF
# Install Flutter
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    RC_FILE="$HOME/.zshrc" RC_SYNTAX="posix" LOGIN_SHELL="zsh" COCOON_INSTALL_METHOD="archive" PIN="" CHECKSUM_AMD64="" CHECKSUM_ARM64="" bash <<'COCOON_PLUGIN_EOF'
#!/usr/bin/env bash
# Install Flutter SDK (https://github.com/flutter/flutter)
#
# Inputs (env):
#   PIN              : Flutter version (e.g. "3.44.0"); empty = latest stable
#   CHECKSUM_AMD64   : sha256 of linux-x64 tarball; empty to skip verification
#   CHECKSUM_ARM64   : unused — Flutter Linux is x86_64 only
#
# Note: Flutter does not publish official Linux/arm64 builds. On arm64 hosts
# the install fails fast and asks the user to run the container under
# `docker --platform linux/amd64` (Docker Desktop does this automatically on
# Apple Silicon, so this only affects native arm64 Linux hosts).
set -euo pipefail

# Yellow WARNING when stderr is a TTY (and NO_COLOR is unset) or
# FORCE_COLOR is set. NO_COLOR wins per no-color.org.
if [ -n "${NO_COLOR:-}" ]; then
  C_YEL=''
  C_RST=''
elif [ -n "${FORCE_COLOR:-}" ] || [ -t 2 ]; then
  C_YEL=$'\033[33m'
  C_RST=$'\033[0m'
else
  C_YEL=''
  C_RST=''
fi

ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
  amd64)
    CHECKSUM="$CHECKSUM_AMD64"
    ;;
  *)
    echo "ERROR: Flutter does not publish official Linux/${ARCH} builds." >&2
    echo "       Re-run the container under 'docker --platform linux/amd64'" >&2
    echo "       (Docker Desktop does this automatically on Apple Silicon)." >&2
    exit 1
    ;;
esac

if [ -n "$PIN" ]; then
  VERSION="$PIN"
else
  # Resolve latest stable from the official releases manifest. Cross-reference
  # current_release.stable -> releases[].hash to pick the correct version
  # without depending on jq or the GitHub API.
  MANIFEST=$(curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
    https://storage.googleapis.com/flutter_infra_release/releases/releases_linux.json)
  STABLE_HASH=$(printf '%s' "$MANIFEST" | tr -d '\n' |
    sed -n 's/.*"current_release"[[:space:]]*:[[:space:]]*{[^}]*"stable"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  if [ -z "$STABLE_HASH" ]; then
    echo "Failed to read current_release.stable from Flutter manifest" >&2
    exit 1
  fi
  # `|| true` keeps the command substitution non-fatal: under `set -euo
  # pipefail`, a no-match from `grep -oE` (e.g. manifest shape change) would
  # otherwise exit the script via the pipeline's non-zero status before the
  # friendly `-z "$VERSION"` check below could run. Let the empty-VERSION
  # branch emit the actionable error instead.
  VERSION=$(printf '%s' "$MANIFEST" | tr -d '\n' |
    grep -oE "\\{[^{}]*\"hash\"[[:space:]]*:[[:space:]]*\"${STABLE_HASH}\"[^{}]*\\}" |
    sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1) || true
  if [ -z "$VERSION" ]; then
    echo "Failed to resolve latest Flutter stable version" >&2
    exit 1
  fi
fi

curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
  "https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${VERSION}-stable.tar.xz" \
  -o /tmp/flutter.tar.xz

if [ -n "$CHECKSUM" ]; then
  echo "${CHECKSUM}  /tmp/flutter.tar.xz" | sha256sum -c -
else
  printf '%sWARNING: SHA256 verification skipped for Flutter (no checksum for flutter in [plugins.versions])%s\n' "$C_YEL" "$C_RST" >&2
fi

# Tarball root is "flutter/" — extract directly into /usr/local.
tar -C /usr/local -xJf /tmp/flutter.tar.xz
rm /tmp/flutter.tar.xz

# Flutter writes inside its own SDK tree at runtime (bin/cache/ for engine
# binaries, dart-sdk stamps, pre-cached artifacts), so the non-root container
# user must own /usr/local/flutter. Chown inside the same RUN keeps the
# ownership flip in a single image layer (no duplicated 700 MB SDK).
chown -R "${USERNAME}:${USERNAME}" /usr/local/flutter
COCOON_PLUGIN_EOF
ENV PUB_CACHE="/home/${USERNAME}/.pub-cache"
ENV FLUTTER_ROOT="/usr/local/flutter"
ENV PATH="/usr/local/flutter/bin:/usr/local/flutter/bin/cache/dart-sdk/bin:$PUB_CACHE/bin:$PATH"
# Install GitHub CLI
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    RC_FILE="$HOME/.zshrc" RC_SYNTAX="posix" LOGIN_SHELL="zsh" COCOON_INSTALL_METHOD="apt" bash <<'COCOON_PLUGIN_EOF'
#!/usr/bin/env bash
# Install GitHub CLI (https://github.com/cli/cli)
set -euo pipefail

mkdir -p /etc/apt/keyrings
chmod 755 /etc/apt/keyrings
curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
  https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  >/etc/apt/sources.list.d/github-cli.list

apt-get update
apt-get install -y --no-install-recommends gh
apt-get clean
rm -rf /var/lib/apt/lists/* /var/tmp/*
COCOON_PLUGIN_EOF
# Install Go
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    RC_FILE="$HOME/.zshrc" RC_SYNTAX="posix" LOGIN_SHELL="zsh" COCOON_INSTALL_METHOD="archive" PIN="" CHECKSUM_AMD64="" CHECKSUM_ARM64="" bash <<'COCOON_PLUGIN_EOF'
#!/usr/bin/env bash
# Install Go (https://github.com/golang/go)
#
# Inputs (env):
#   PIN              : Go version to install (e.g. "1.23.0"); empty = latest
#   CHECKSUM_AMD64   : sha256 of amd64 tarball; empty to skip verification
#   CHECKSUM_ARM64   : sha256 of arm64 tarball; empty to skip verification
set -euo pipefail

# Yellow WARNING when stderr is a TTY (and NO_COLOR is unset) or
# FORCE_COLOR is set. NO_COLOR wins per no-color.org.
if [ -n "${NO_COLOR:-}" ]; then
  C_YEL=''
  C_RST=''
elif [ -n "${FORCE_COLOR:-}" ] || [ -t 2 ]; then
  C_YEL=$'\033[33m'
  C_RST=$'\033[0m'
else
  C_YEL=''
  C_RST=''
fi

ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
  amd64) CHECKSUM="$CHECKSUM_AMD64" ;;
  arm64) CHECKSUM="$CHECKSUM_ARM64" ;;
  *) CHECKSUM="$CHECKSUM_AMD64" ;;
esac

if [ -n "$PIN" ]; then
  VERSION="$PIN"
else
  VERSION=$(curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
    https://go.dev/VERSION?m=text | head -1 | sed 's/^go//')
fi

curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
  "https://go.dev/dl/go${VERSION}.linux-${ARCH}.tar.gz" -o /tmp/go.tar.gz

if [ -n "$CHECKSUM" ]; then
  echo "${CHECKSUM}  /tmp/go.tar.gz" | sha256sum -c -
else
  printf '%sWARNING: SHA256 verification skipped for Go (no checksum for go in [plugins.versions])%s\n' "$C_YEL" "$C_RST" >&2
fi

tar -C /usr/local -xzf /tmp/go.tar.gz
rm /tmp/go.tar.gz
COCOON_PLUGIN_EOF
ENV GOPATH="/home/${USERNAME}/go"
ENV PATH="/usr/local/go/bin:$GOPATH/bin:$PATH"
# Install ShellCheck
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    RC_FILE="$HOME/.zshrc" RC_SYNTAX="posix" LOGIN_SHELL="zsh" COCOON_INSTALL_METHOD="binary" PIN="" CHECKSUM_AMD64="" CHECKSUM_ARM64="" bash <<'COCOON_PLUGIN_EOF'
#!/usr/bin/env bash
# Install ShellCheck (https://github.com/koalaman/shellcheck)
#
# Inputs (env):
#   PIN              : ShellCheck version without leading "v" (e.g. "0.10.0"); empty = latest
#   CHECKSUM_AMD64   : sha256 of the x86_64 tarball; empty to skip verification
#   CHECKSUM_ARM64   : sha256 of the aarch64 tarball; empty to skip verification
set -euo pipefail

# Yellow WARNING when stderr is a TTY (and NO_COLOR is unset) or
# FORCE_COLOR is set. NO_COLOR wins per no-color.org.
if [ -n "${NO_COLOR:-}" ]; then
  C_YEL=''
  C_RST=''
elif [ -n "${FORCE_COLOR:-}" ] || [ -t 2 ]; then
  C_YEL=$'\033[33m'
  C_RST=$'\033[0m'
else
  C_YEL=''
  C_RST=''
fi

ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
  amd64)
    DOWNLOAD_ARCH="x86_64"
    CHECKSUM="$CHECKSUM_AMD64"
    ;;
  arm64)
    DOWNLOAD_ARCH="aarch64"
    CHECKSUM="$CHECKSUM_ARM64"
    ;;
  *)
    DOWNLOAD_ARCH="x86_64"
    CHECKSUM="$CHECKSUM_AMD64"
    ;;
esac

if [ -n "$PIN" ]; then
  VERSION="$PIN"
else
  VERSION=$(curl -fsSLI --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
    -o /dev/null -w '%{url_effective}' https://github.com/koalaman/shellcheck/releases/latest |
    sed 's|.*/tag/v||')
fi

curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
  "https://github.com/koalaman/shellcheck/releases/download/v${VERSION}/shellcheck-v${VERSION}.linux.${DOWNLOAD_ARCH}.tar.xz" \
  -o /tmp/shellcheck.tar.xz

if [ -n "$CHECKSUM" ]; then
  echo "${CHECKSUM}  /tmp/shellcheck.tar.xz" | sha256sum -c -
else
  printf '%sWARNING: SHA256 verification skipped for ShellCheck (no checksum for shellcheck in [plugins.versions])%s\n' "$C_YEL" "$C_RST" >&2
fi

# The tarball ships `shellcheck-v<ver>/shellcheck`; --strip-components=1 +
# selective extract lands just the binary in /usr/local/bin.
tar -xJf /tmp/shellcheck.tar.xz -C /usr/local/bin --strip-components=1 \
  "shellcheck-v${VERSION}/shellcheck"
chmod +x /usr/local/bin/shellcheck
rm /tmp/shellcheck.tar.xz
COCOON_PLUGIN_EOF
# Install shfmt
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    RC_FILE="$HOME/.zshrc" RC_SYNTAX="posix" LOGIN_SHELL="zsh" COCOON_INSTALL_METHOD="binary" PIN="" CHECKSUM_AMD64="" CHECKSUM_ARM64="" bash <<'COCOON_PLUGIN_EOF'
#!/usr/bin/env bash
# Install shfmt (https://github.com/mvdan/sh)
#
# Inputs (env):
#   PIN              : shfmt version without leading "v" (e.g. "3.10.0"); empty = latest
#   CHECKSUM_AMD64   : sha256 of the amd64 binary; empty to skip verification
#   CHECKSUM_ARM64   : sha256 of the arm64 binary; empty to skip verification
set -euo pipefail

# Yellow WARNING when stderr is a TTY (and NO_COLOR is unset) or
# FORCE_COLOR is set. NO_COLOR wins per no-color.org.
if [ -n "${NO_COLOR:-}" ]; then
  C_YEL=''
  C_RST=''
elif [ -n "${FORCE_COLOR:-}" ] || [ -t 2 ]; then
  C_YEL=$'\033[33m'
  C_RST=$'\033[0m'
else
  C_YEL=''
  C_RST=''
fi

ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
  amd64) CHECKSUM="$CHECKSUM_AMD64" ;;
  arm64) CHECKSUM="$CHECKSUM_ARM64" ;;
  *) CHECKSUM="$CHECKSUM_AMD64" ;;
esac

if [ -n "$PIN" ]; then
  VERSION="$PIN"
else
  VERSION=$(curl -fsSLI --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
    -o /dev/null -w '%{url_effective}' https://github.com/mvdan/sh/releases/latest |
    sed 's|.*/tag/v||')
fi

curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
  "https://github.com/mvdan/sh/releases/download/v${VERSION}/shfmt_v${VERSION}_linux_${ARCH}" \
  -o /tmp/shfmt

if [ -n "$CHECKSUM" ]; then
  echo "${CHECKSUM}  /tmp/shfmt" | sha256sum -c -
else
  printf '%sWARNING: SHA256 verification skipped for shfmt (no checksum for shfmt in [plugins.versions])%s\n' "$C_YEL" "$C_RST" >&2
fi

install -o root -g root -m 0755 /tmp/shfmt /usr/local/bin/shfmt
rm /tmp/shfmt
COCOON_PLUGIN_EOF
# Install Starship
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    RC_FILE="$HOME/.zshrc" RC_SYNTAX="posix" LOGIN_SHELL="zsh" COCOON_INSTALL_METHOD="binary" PIN="" CHECKSUM_AMD64="" CHECKSUM_ARM64="" bash <<'COCOON_PLUGIN_EOF'
#!/usr/bin/env bash
# Install Starship (https://github.com/starship/starship)
#
# Inputs (env):
#   PIN              : Starship version (without leading "v"); empty = latest
#   CHECKSUM_AMD64   : sha256 of amd64 tarball; empty to skip verification
#   CHECKSUM_ARM64   : sha256 of arm64 tarball; empty to skip verification
set -euo pipefail

# Yellow WARNING when stderr is a TTY (and NO_COLOR is unset) or
# FORCE_COLOR is set. NO_COLOR wins per no-color.org.
if [ -n "${NO_COLOR:-}" ]; then
  C_YEL=''
  C_RST=''
elif [ -n "${FORCE_COLOR:-}" ] || [ -t 2 ]; then
  C_YEL=$'\033[33m'
  C_RST=$'\033[0m'
else
  C_YEL=''
  C_RST=''
fi

ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
  amd64)
    DOWNLOAD_ARCH="x86_64"
    CHECKSUM="$CHECKSUM_AMD64"
    ;;
  arm64)
    DOWNLOAD_ARCH="aarch64"
    CHECKSUM="$CHECKSUM_ARM64"
    ;;
  *)
    DOWNLOAD_ARCH="x86_64"
    CHECKSUM="$CHECKSUM_AMD64"
    ;;
esac

if [ -n "$PIN" ]; then
  VERSION="$PIN"
else
  VERSION=$(curl -fsSLI --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
    -o /dev/null -w '%{url_effective}' https://github.com/starship/starship/releases/latest |
    sed 's|.*/tag/v||')
fi

curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
  "https://github.com/starship/starship/releases/download/v${VERSION}/starship-${DOWNLOAD_ARCH}-unknown-linux-musl.tar.gz" \
  -o /tmp/starship.tar.gz

if [ -n "$CHECKSUM" ]; then
  echo "${CHECKSUM}  /tmp/starship.tar.gz" | sha256sum -c -
else
  printf '%sWARNING: SHA256 verification skipped for Starship (no checksum for starship in [plugins.versions])%s\n' "$C_YEL" "$C_RST" >&2
fi

tar -xzf /tmp/starship.tar.gz -C /usr/local/bin starship
rm /tmp/starship.tar.gz
COCOON_PLUGIN_EOF
USER ${USERNAME}
# Install AWS CLI v2
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    RC_FILE="$HOME/.zshrc" RC_SYNTAX="posix" LOGIN_SHELL="zsh" COCOON_INSTALL_METHOD="archive" PIN="" bash <<'COCOON_PLUGIN_EOF'
#!/usr/bin/env bash
# Install AWS CLI v2 (https://github.com/aws/aws-cli)
#
# Integrity: AWS publishes no SHA256 checksums for the installer zip — only
# a detached PGP signature (.zip.sig). This script verifies the download
# against the AWS CLI Team public key bundled below. The key ships with
# cocoon (a different trust domain than awscli.amazonaws.com), so a poisoned
# CDN cannot supply both a malicious zip and a matching key.
#
# Key maintenance: the bundled key (fingerprint
# FB5DB77FD5C118B80511ADA8A6310ACC4672475C) expires 2026-07-07. After AWS
# extends the expiry, refresh the block below from the AWS CLI install guide
# (https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html).
# A stale key does not break installs — gpg --verify still exits 0 for an
# expired-key signature — it only weakens the freshness of the check.
#
# Inputs (env):
#   PIN : AWS CLI v2 version (without leading "v"); empty = latest.
#         This plugin declares verify = "pgp"; CHECKSUM_AMD64 / CHECKSUM_ARM64
#         are not passed and not consulted.
set -euo pipefail

ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
  amd64) CLI_ARCH="x86_64" ;;
  arm64) CLI_ARCH="aarch64" ;;
  *) CLI_ARCH="x86_64" ;;
esac

if [ -n "$PIN" ]; then
  BASE="awscli-exe-linux-${CLI_ARCH}-${PIN}.zip"
else
  BASE="awscli-exe-linux-${CLI_ARCH}.zip"
fi

GNUPGHOME="$(mktemp -d)"
export GNUPGHOME
trap 'rm -rf "$GNUPGHOME" awscliv2.zip awscliv2.sig aws' EXIT

curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
  "https://awscli.amazonaws.com/${BASE}" -o awscliv2.zip
curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
  "https://awscli.amazonaws.com/${BASE}.sig" -o awscliv2.sig

gpg --batch --quiet --import <<'AWS_CLI_PGP_KEY'
-----BEGIN PGP PUBLIC KEY BLOCK-----

mQINBF2Cr7UBEADJZHcgusOJl7ENSyumXh85z0TRV0xJorM2B/JL0kHOyigQluUG
ZMLhENaG0bYatdrKP+3H91lvK050pXwnO/R7fB/FSTouki4ciIx5OuLlnJZIxSzx
PqGl0mkxImLNbGWoi6Lto0LYxqHN2iQtzlwTVmq9733zd3XfcXrZ3+LblHAgEt5G
TfNxEKJ8soPLyWmwDH6HWCnjZ/aIQRBTIQ05uVeEoYxSh6wOai7ss/KveoSNBbYz
gbdzoqI2Y8cgH2nbfgp3DSasaLZEdCSsIsK1u05CinE7k2qZ7KgKAUIcT/cR/grk
C6VwsnDU0OUCideXcQ8WeHutqvgZH1JgKDbznoIzeQHJD238GEu+eKhRHcz8/jeG
94zkcgJOz3KbZGYMiTh277Fvj9zzvZsbMBCedV1BTg3TqgvdX4bdkhf5cH+7NtWO
lrFj6UwAsGukBTAOxC0l/dnSmZhJ7Z1KmEWilro/gOrjtOxqRQutlIqG22TaqoPG
fYVN+en3Zwbt97kcgZDwqbuykNt64oZWc4XKCa3mprEGC3IbJTBFqglXmZ7l9ywG
EEUJYOlb2XrSuPWml39beWdKM8kzr1OjnlOm6+lpTRCBfo0wa9F8YZRhHPAkwKkX
XDeOGpWRj4ohOx0d2GWkyV5xyN14p2tQOCdOODmz80yUTgRpPVQUtOEhXQARAQAB
tCFBV1MgQ0xJIFRlYW0gPGF3cy1jbGlAYW1hem9uLmNvbT6JAlQEEwEIAD4CGwMF
CwkIBwIGFQoJCAsCBBYCAwECHgECF4AWIQT7Xbd/1cEYuAURraimMQrMRnJHXAUC
aGveYQUJDMpiLAAKCRCmMQrMRnJHXKBYD/9Ab0qQdGiO5hObchG8xh8Rpb4Mjyf6
0JrVo6m8GNjNj6BHkSc8fuTQJ/FaEhaQxj3pjZ3GXPrXjIIVChmICLlFuRXYzrXc
Pw0lniybypsZEVai5kO0tCNBCCFuMN9RsmmRG8mf7lC4FSTbUDmxG/QlYK+0IV/l
uJkzxWa+rySkdpm0JdqumjegNRgObdXHAQDWlubWQHWyZyIQ2B4U7AxqSpcdJp6I
S4Zds4wVLd1WE5pquYQ8vS2cNlDm4QNg8wTj58e3lKN47hXHMIb6CHxRnb947oJa
pg189LLPR5koh+EorNkA1wu5mAJtJvy5YMsppy2y/kIjp3lyY6AmPT1posgGk70Z
CmToEZ5rbd7ARExtlh76A0cabMDFlEHDIK8RNUOSRr7L64+KxOUegKBfQHb9dADY
qqiKqpCbKgvtWlds909Ms74JBgr2KwZCSY1HaOxnIr4CY43QRqAq5YHOay/mU+6w
hhmdF18vpyK0vfkvvGresWtSXbag7Hkt3XjaEw76BzxQH21EBDqU8WJVjHgU6ru+
DJTs+SxgJbaT3hb/vyjlw0lK+hFfhWKRwgOXH8vqducF95NRSUxtS4fpqxWVaw3Q
V2OWSjbne99A5EPEySzryFTKbMGwaTlAwMCwYevt4YT6eb7NmFhTx0Fis4TalUs+
j+c7Kg92pDx2uQ==
=OBAt
-----END PGP PUBLIC KEY BLOCK-----
AWS_CLI_PGP_KEY

# Fail closed if the bundled key block is ever mangled or replaced. A gpg
# failure here aborts via set -e with gpg's own stderr intact; only a
# successful listing that lacks the expected fingerprint reaches the
# mismatch branch, so the two failure modes stay distinguishable.
fpr_listing="$(gpg --batch --with-colons --fingerprint)"
if ! printf '%s\n' "$fpr_listing" |
  grep -q '^fpr:::::::::FB5DB77FD5C118B80511ADA8A6310ACC4672475C:'; then
  echo "ERROR: bundled AWS CLI signing key did not yield the expected fingerprint" >&2
  echo "       (want FB5DB77FD5C118B80511ADA8A6310ACC4672475C); gpg --fingerprint gave:" >&2
  printf '%s\n' "$fpr_listing" >&2
  exit 1
fi

gpg --batch --verify awscliv2.sig awscliv2.zip

unzip awscliv2.zip
sudo ./aws/install
COCOON_PLUGIN_EOF
# Install Claude Code
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    RC_FILE="$HOME/.zshrc" RC_SYNTAX="posix" LOGIN_SHELL="zsh" COCOON_INSTALL_METHOD="installer" bash <<'COCOON_PLUGIN_EOF'
#!/usr/bin/env bash
# Install Claude Code (https://github.com/anthropics/claude-code)
set -euo pipefail

curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
  https://claude.ai/install.sh | bash
COCOON_PLUGIN_EOF
ENV PATH="/home/${USERNAME}/.local/bin:$PATH"
# Install GitHub Copilot CLI
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    RC_FILE="$HOME/.zshrc" RC_SYNTAX="posix" LOGIN_SHELL="zsh" COCOON_INSTALL_METHOD="binary" PIN="" CHECKSUM_AMD64="" CHECKSUM_ARM64="" bash <<'COCOON_PLUGIN_EOF'
#!/usr/bin/env bash
# Install GitHub Copilot CLI from the GitHub Releases binary tarball
# (https://github.com/github/copilot-cli/releases). Picked when gh.io is
# blocked (e.g. Zscaler) or corporate policy forbids the `curl | bash`
# pattern that install.gh-cli.sh uses.
#
# Inputs (env):
#   PIN                   : Copilot CLI version (without leading "v"); empty = latest
#   CHECKSUM_AMD64        : sha256 of copilot-linux-x64.tar.gz; empty to skip verification
#   CHECKSUM_ARM64        : sha256 of copilot-linux-arm64.tar.gz; empty to skip verification
#   COCOON_INSTALL_METHOD : selected install method; must equal "binary"
set -euo pipefail

: "${COCOON_INSTALL_METHOD:?missing}"
if [ "$COCOON_INSTALL_METHOD" != "binary" ]; then
  echo "install.binary.sh invoked with COCOON_INSTALL_METHOD=$COCOON_INSTALL_METHOD; expected binary" >&2
  exit 1
fi

# Yellow WARNING when stderr is a TTY (and NO_COLOR is unset) or
# FORCE_COLOR is set. NO_COLOR wins per no-color.org.
if [ -n "${NO_COLOR:-}" ]; then
  C_YEL=''
  C_RST=''
elif [ -n "${FORCE_COLOR:-}" ] || [ -t 2 ]; then
  C_YEL=$'\033[33m'
  C_RST=$'\033[0m'
else
  C_YEL=''
  C_RST=''
fi

ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
  amd64)
    DOWNLOAD_ARCH="x64"
    CHECKSUM="$CHECKSUM_AMD64"
    ;;
  arm64)
    DOWNLOAD_ARCH="arm64"
    CHECKSUM="$CHECKSUM_ARM64"
    ;;
  *)
    DOWNLOAD_ARCH="x64"
    CHECKSUM="$CHECKSUM_AMD64"
    ;;
esac

if [ -n "$PIN" ]; then
  VERSION="$PIN"
else
  VERSION=$(curl -fsSLI --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
    -o /dev/null -w '%{url_effective}' https://github.com/github/copilot-cli/releases/latest |
    sed 's|.*/tag/v||')
fi

TARBALL="copilot-linux-${DOWNLOAD_ARCH}.tar.gz"
curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
  "https://github.com/github/copilot-cli/releases/download/v${VERSION}/${TARBALL}" \
  -o "/tmp/${TARBALL}"

if [ -n "$CHECKSUM" ]; then
  echo "${CHECKSUM}  /tmp/${TARBALL}" | sha256sum -c -
else
  printf '%sWARNING: SHA256 verification skipped for Copilot CLI (no checksum for copilot-cli in [plugins.versions])%s\n' "$C_YEL" "$C_RST" >&2
fi

# The release tarball is a single self-contained ELF binary at the
# archive root (no leading directory), so a straight `tar -xzf` into
# ~/.local/bin lands the launcher directly on PATH (install.env adds
# ~/.local/bin to PATH). NB: do NOT add --strip-components=1 — that
# would silently skip the file because there is no leading path
# component to strip.
mkdir -p "$HOME/.local/bin"
tar -C "$HOME/.local/bin" -xzf "/tmp/${TARBALL}"
# Tarball entry already ships mode 0755, but re-assert it in case a
# future release ships a more permissive umask-dependent mode.
chmod 0755 "$HOME/.local/bin/copilot"

rm "/tmp/${TARBALL}"
COCOON_PLUGIN_EOF
ENV PATH="/home/${USERNAME}/.local/bin:$PATH"
# Install Rust
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    RC_FILE="$HOME/.zshrc" RC_SYNTAX="posix" LOGIN_SHELL="zsh" COCOON_INSTALL_METHOD="installer" bash <<'COCOON_PLUGIN_EOF'
#!/usr/bin/env bash
# Install Rust toolchain via rustup (https://github.com/rust-lang/rustup)
#
# Inputs (env):
#   RC_FILE   : absolute path to the user's login-shell rc file
#   RC_SYNTAX : "posix" (bash/zsh) or "fish"
set -euo pipefail

curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
  https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --component clippy --component rustfmt

if [ "${RC_SYNTAX:-posix}" = "fish" ]; then
  # rustup writes both env (POSIX) and env.fish. Fall back to a literal PATH
  # extension if env.fish is somehow absent so the plugin stays robust across
  # rustup versions.
  if [ -f "$HOME/.cargo/env.fish" ]; then
    # shellcheck disable=SC2016
    echo 'source "$HOME/.cargo/env.fish"' >>"$RC_FILE"
  else
    # shellcheck disable=SC2016
    echo 'set -gx PATH $HOME/.cargo/bin $PATH' >>"$RC_FILE"
  fi
else
  # shellcheck disable=SC2016
  echo '. "$HOME/.cargo/env"' >>"$RC_FILE"
fi
COCOON_PLUGIN_EOF
ENV PATH="/home/${USERNAME}/.cargo/bin:$PATH"
# Install uv
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    RC_FILE="$HOME/.zshrc" RC_SYNTAX="posix" LOGIN_SHELL="zsh" COCOON_INSTALL_METHOD="installer" PIN="" CHECKSUM_AMD64="" CHECKSUM_ARM64="" bash <<'COCOON_PLUGIN_EOF'
#!/usr/bin/env bash
# Install uv (fast Python package and project manager) (https://github.com/astral-sh/uv)
#
# Inputs (env):
#   PIN       : uv version to install; empty = latest
#   RC_FILE   : absolute path to the user's login-shell rc file
#   RC_SYNTAX : "posix" (bash/zsh) or "fish"
set -euo pipefail

if [ -n "$PIN" ]; then
  curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
    "https://astral.sh/uv/${PIN}/install.sh" | bash
else
  curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --retry-all-errors \
    https://astral.sh/uv/install.sh | bash
fi

if [ "${RC_SYNTAX:-posix}" = "fish" ]; then
  # shellcheck disable=SC2016
  echo 'set -gx PATH $HOME/.local/bin $PATH' >>"$RC_FILE"
else
  # shellcheck disable=SC2016
  echo 'export PATH="$HOME/.local/bin:$PATH"' >>"$RC_FILE"
fi
COCOON_PLUGIN_EOF
ENV PATH="/home/${USERNAME}/.local/bin:$PATH"
# Configure Starship (user)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    RC_FILE="$HOME/.zshrc" RC_SYNTAX="posix" LOGIN_SHELL="zsh" COCOON_INSTALL_METHOD="binary" PIN="" CHECKSUM_AMD64="" CHECKSUM_ARM64="" bash <<'COCOON_PLUGIN_EOF'
#!/usr/bin/env bash
# Configure Starship for the user's login shell.
#
# Inputs (env):
#   RC_FILE     : absolute path to the user's login-shell rc file
#   RC_SYNTAX   : "posix" (bash/zsh) or "fish"
#   LOGIN_SHELL : "bash" / "zsh" / "fish" — picks `starship init <shell>`
set -euo pipefail

shell="${LOGIN_SHELL:-bash}"
if [ "${RC_SYNTAX:-posix}" = "fish" ]; then
  echo "starship init ${shell} | source" >>"$RC_FILE"
else
  # shellcheck disable=SC2016
  echo "eval \"\$(starship init ${shell})\"" >>"$RC_FILE"
fi
COCOON_PLUGIN_EOF

# === user-defined dockerfile.post_plugins (from workspace.toml) ===
RUN npm config set prefix "$HOME/.local"
# === end dockerfile.post_plugins ===

# Backup image-installed files for volume-mount resilience
RUN if [ -d ~/.local ]; then cp -a ~/.local ~/.image-local; else mkdir -p ~/.image-local; fi

# create volume mount directories for permission
RUN mkdir -p ~/.local

# Setup persistent shell history
RUN echo 'export HISTFILE=~/.local/state/.zsh_history_docker' >> "$HOME/.zshrc" && \
    echo 'export HISTSIZE=10000' >> "$HOME/.zshrc" && \
    echo 'export SAVEHIST=20000' >> "$HOME/.zshrc" && \
    mkdir -p ~/.local/state && touch ~/.local/state/.zsh_history_docker

# Inject [container.shell] env/aliases plus persistent shellrc bootstrap
RUN <<COCOON_RC_BLOCK
cat >>"$HOME/.zshrc" <<'COCOON_RC'
# Auto-generated from [container.shell] of workspace.toml.

# Aliases
alias d=docker
alias dc='docker compose'
alias dcdown='docker compose down'
alias dcup='docker compose up -d'
alias ga='git add'
alias gc='git commit'
alias gco='git checkout'
alias gd='git diff'
alias gl='git log --oneline --graph --decorate'
alias gp='git push'
alias gs='git status'
alias la='ls -A'
alias ll='ls -lah'
alias lt='ls -ltrh'

# Source persistent user shellrc from the cocoon named volume
[ -f "$HOME/.cocoon/.shellrc" ] && . "$HOME/.cocoon/.shellrc"
COCOON_RC
COCOON_RC_BLOCK

# Entrypoint: runs as root to remap UID/GID to the host owner, then drops
# privileges to ${USERNAME} and re-execs itself. The unprivileged re-entry
# syncs image files into the volume-mounted ~/.local before exec'ing CMD.
USER root
COPY .devcontainer/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["sleep", "infinity"]

WORKDIR /home/${USERNAME}/work
