#!/bin/bash
set -euo pipefail
authorized_keys_source=/run/secrets/devuser_authorized_keys
if [[ ! -f "$authorized_keys_source" || ! -s "$authorized_keys_source" ]]; then
  printf '%s\n' 'Runtime SSH public key file is required at /run/secrets/devuser_authorized_keys' >&2
  exit 1
fi

install -d -o devuser -g devuser -m 0700 /home/devuser/.ssh
install -o devuser -g devuser -m 0600 "$authorized_keys_source" /home/devuser/.ssh/authorized_keys

install -d -m 0755 /run/sshd
exec /usr/sbin/sshd -D -e
