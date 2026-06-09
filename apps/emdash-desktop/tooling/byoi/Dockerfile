FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# ── System packages ───────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server \
    git \
    curl \
    wget \
    tmux \
    sudo \
    jq \
    ca-certificates \
    gnupg \
    bash \
    zsh \
    vim \
    nano \
    less \
    build-essential \
    python3 \
    procps \
    && rm -rf /var/lib/apt/lists/*

# ── GitHub CLI ────────────────────────────────────────────────────────────────
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# ── Node.js 22 LTS ────────────────────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN npm config set fund false && npm config set audit false

# ── Claude Code ───────────────────────────────────────────────────────────────
RUN npm install -g @anthropic-ai/claude-code

# ── Optional: additional agents (uncomment as needed) ────────────────────────
# RUN npm install -g @openai/codex
# RUN npm install -g @google/gemini-cli

# ── Dev user ──────────────────────────────────────────────────────────────────
# Username: devuser  Password: devpass
# Change both here and CONTAINER_PASS in scripts/provision.sh if you want a
# different password.
RUN useradd -m -s /bin/bash devuser \
    && echo 'devuser:devpass' | chpasswd \
    && usermod -aG sudo devuser \
    && echo 'devuser ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers.d/devuser

# ── SSH server ────────────────────────────────────────────────────────────────
RUN mkdir -p /var/run/sshd \
    && ssh-keygen -A

RUN sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config \
    && sed -i 's/PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config \
    && echo 'PermitUserEnvironment yes' >> /etc/ssh/sshd_config \
    && echo 'ClientAliveInterval 60' >> /etc/ssh/sshd_config \
    && echo 'ClientAliveCountMax 10' >> /etc/ssh/sshd_config \
    && echo 'X11Forwarding no' >> /etc/ssh/sshd_config

# ── Git defaults for devuser ──────────────────────────────────────────────────
USER devuser
WORKDIR /home/devuser

RUN git config --global user.email "devuser@emdash-dev" \
    && git config --global user.name "Emdash Dev" \
    && git config --global init.defaultBranch main \
    && git config --global safe.directory '*'

RUN mkdir -p /home/devuser/workspace \
    && mkdir -p /home/devuser/.ssh && chmod 700 /home/devuser/.ssh

RUN echo 'set -g default-terminal "xterm-256color"' > /home/devuser/.tmux.conf \
    && echo 'set -g history-limit 50000' >> /home/devuser/.tmux.conf \
    && echo 'set-option -g allow-rename on' >> /home/devuser/.tmux.conf

# ── Startup ───────────────────────────────────────────────────────────────────
USER root

COPY --chmod=755 entrypoint.sh /entrypoint.sh

EXPOSE 22

ENTRYPOINT ["/entrypoint.sh"]
