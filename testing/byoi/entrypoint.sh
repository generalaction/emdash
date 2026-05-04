#!/bin/bash
set -e

# Write API keys passed as container env vars into devuser's ~/.ssh/environment
# so they're available in SSH sessions (requires PermitUserEnvironment yes in sshd_config).
ENV_FILE=/home/devuser/.ssh/environment
: > "$ENV_FILE"
chown devuser:devuser "$ENV_FILE"
chmod 600 "$ENV_FILE"

AGENT_VARS=(
  ANTHROPIC_API_KEY
  OPENAI_API_KEY
  GH_TOKEN
  GITHUB_TOKEN
  GEMINI_API_KEY
  GOOGLE_API_KEY
  AMP_API_KEY
  DASHSCOPE_API_KEY
  KIMI_API_KEY
  MISTRAL_API_KEY
  CODEBUFF_API_KEY
  FACTORY_API_KEY
  CURSOR_API_KEY
)

for var in "${AGENT_VARS[@]}"; do
  val="${!var:-}"
  if [ -n "$val" ]; then
    echo "${var}=${val}" >> "$ENV_FILE"
  fi
done

exec /usr/sbin/sshd -D -e
