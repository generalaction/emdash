# emdash-runner — minimal image for headless `claude -p` runs against a repo.
#
# Build (on the server):
#   docker build -t emdash-runner:latest packages/emdash-server/runner
#
# The container runs as the host uid:gid (passed via `docker run -u`), works in
# /work (a bind-mounted host repo), and authenticates claude via the
# CLAUDE_CODE_OAUTH_TOKEN env var. Add language toolchains your repos need below.
FROM node:22-bookworm-slim

# git for pull/commit/push; ca-certificates for HTTPS; curl for the installer.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       git ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# Install Claude Code (native installer) into a system-wide location so any uid
# can run it. The installer drops the binary in ~/.local/bin; we relocate it.
RUN curl -fsSL https://claude.ai/install.sh | bash \
  && cp "$HOME/.local/bin/claude" /usr/local/bin/claude \
  && chmod 0755 /usr/local/bin/claude \
  && claude --version

# The container is run with `-u <uid>:<gid>` (a host user with no /etc/passwd
# entry). HOME is set to /tmp by `docker run -e HOME=/tmp` so claude can write
# its config/cache. /work is the bind-mounted repo (working dir set by -w).
WORKDIR /work

# No ENTRYPOINT: the runner invokes `bash -lc "<script>"` explicitly so it can
# compose git + claude + push in one shell.
