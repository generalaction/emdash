# SSH Remote Projects Setup Guide

This guide covers how to use Emdash's SSH feature to work with remote projects on remote servers via SSH/SFTP.

## Overview

Emdash supports remote development by connecting to servers via SSH. This allows you to:

- Run coding agents on remote machines
- Access and edit files on remote servers through SFTP
- Execute Git operations on remote repositories
- Use worktrees for parallel development on remote hosts

### How It Works

When you add a remote project:
1. Emdash establishes an SSH connection to your server
2. Files are accessed via SFTP for browsing and editing
3. Git operations run over SSH commands
4. Coding agents execute in remote worktrees
5. All connections use your system's SSH agent or configured keys

## Preparing Your Remote Server

Before adding a remote project in Emdash, set up your server with the required tools.

### 1. Install Git

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y git

# Configure identity (required for commits)
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
```

### 2. Install GitHub CLI (for PR features)

The `gh` CLI is required for creating PRs, viewing check runs, and other GitHub operations from the Emdash UI.

```bash
# Ubuntu/Debian
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] \
  https://cli.github.com/packages stable main" \
  | sudo tee /etc/apt/sources.list.d/github-cli-stable.list > /dev/null
sudo apt update && sudo apt install -y gh

# Authenticate (choose GitHub.com → HTTPS → Login with web browser)
gh auth login
```

### 3. Set Up SSH Key for GitHub (for push/pull)

Git push and pull require SSH authentication to GitHub from the server. Create a dedicated key:

```bash
# Generate a passphrase-free key for non-interactive use
ssh-keygen -t ed25519 -C "server-github" -f ~/.ssh/id_github -N ""

# Add the key to your GitHub account
gh ssh-key add ~/.ssh/id_github.pub --title "My Server"

# Configure git to use this key (use absolute path, not ~)
HOME_DIR=$(eval echo ~)
git config --global core.sshCommand "ssh -i ${HOME_DIR}/.ssh/id_github"

# Trust GitHub's host key
ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null

# Verify it works
ssh -T git@github.com
```

**Important:** Use the absolute path (e.g., `/home/user/.ssh/id_github`) in `core.sshCommand`, not `~`. Emdash runs commands in a non-interactive shell where tilde expansion may not work.

Alternatively, configure SSH directly in `~/.ssh/config`:

```
Host github.com
    IdentityFile /home/user/.ssh/id_github
    IdentitiesOnly yes
```

### 4. Clone or Initialize a Repository

```bash
# Clone an existing repo (use SSH URL for push access)
git clone git@github.com:your-org/your-repo.git

# Or initialize a new repo
mkdir ~/my-project && cd ~/my-project && git init
```

**Note:** If your repo was cloned with HTTPS, switch to SSH for push access:

```bash
git remote set-url origin git@github.com:your-org/your-repo.git
```

### 5. Install a Coding Agent

At least one CLI agent must be installed on the server. For example:

```bash
# Claude Code
curl -fsSL https://claude.ai/install.sh | bash

# Or install another supported agent
```

## Adding a Remote Project

### Step 1: Configure SSH Connection

1. Open **Settings → SSH Connections**
2. Click **"Add Connection"**
3. Enter connection details:

```
Name:           My Server
Host:           server.example.com
Port:           22
Username:       your-username
Auth Type:      [Select method]
```

### Step 2: Test Connection

Before saving, click **"Test Connection"** to verify:
- Network connectivity
- Authentication credentials
- Host key verification

### Step 3: Add Remote Project

1. Go to **Projects → Add Project**
2. Select **"Remote Project"** tab
3. Choose your configured SSH connection
4. Enter the remote path to your project:

```
Connection:     My Server
Project Path:   /home/user/projects/my-app
```

5. Emdash will validate the path and detect Git configuration

## Connection Configuration Options

### Basic Settings

| Option | Description | Default |
|--------|-------------|---------|
| Name | Display name for this connection | Required |
| Host | Server hostname or IP address | Required |
| Port | SSH port (usually 22) | 22 |
| Username | SSH username | Required |

### Connection Timeouts

Emdash uses sensible defaults for connection reliability:

- **Ready Timeout**: 20 seconds (connection establishment)
- **Keepalive Interval**: 60 seconds (connection health check)
- **Keepalive Count Max**: 3 retries before disconnect

These settings ensure stable long-running agent sessions.

## Authentication Methods

Emdash supports three authentication methods, listed from most to least secure:

### 1. SSH Agent (Recommended)

Uses your system's SSH agent for key-based authentication without storing private keys in Emdash.

**Requirements:**
- SSH agent running (`ssh-agent`)
- Key added to agent (`ssh-add ~/.ssh/id_ed25519`)
- `SSH_AUTH_SOCK` environment variable set

**Setup:**
```bash
# Start SSH agent (if not already running)
eval "$(ssh-agent -s)"

# Add your key
ssh-add ~/.ssh/id_ed25519

# Verify
ssh-add -l
```

**macOS Note:** macOS automatically manages the SSH agent via Keychain. Your keys are typically available after first use.

### 2. Private Key

Specify a private key file directly. Emdash reads the key file but stores passphrases securely in your system keychain.

**Supported Key Formats:**
- OpenSSH format (`id_rsa`, `id_ed25519`, `id_ecdsa`)
- PEM format
- Keys with or without passphrases

**Configuration:**
```
Auth Type:        Private Key
Private Key Path: /Users/you/.ssh/id_ed25519
Passphrase:       [if key is encrypted]
```

**Security:** Passphrases are stored in your OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service), not in Emdash's database.

### 3. Password

Direct password authentication. Stored securely in your system keychain.

**When to use:**
- Servers without key-based auth configured
- Temporary/testing connections
- Legacy systems

**Security Note:** Password authentication is less secure than key-based methods. Consider setting up SSH keys for production use.

## Host Key Verification

Emdash verifies server identity using SSH host keys to prevent man-in-the-middle attacks.

### First Connection

When connecting to a new server, you'll see a host key fingerprint:

```
Host Key Verification
Server: server.example.com:22
Fingerprint: SHA256:ABC123xyz...
Algorithm: ssh-ed25519

[Trust Host] [Cancel]
```

Verify the fingerprint matches your server's actual key before trusting.

### Managing Known Hosts

Emdash uses your system's `~/.ssh/known_hosts` file for host key storage. This means:

- Host keys trusted in Emdash are also trusted by your CLI SSH
- Host keys verified via CLI SSH are trusted in Emdash
- No separate host key management needed

### Host Key Changed Warning

If a server's host key changes (e.g., after rebuild), you'll see:

```
WARNING: Host key has changed!
This could indicate a man-in-the-middle attack.

Previous: SHA256:ABC123...
Current:  SHA256:XYZ789...

[View Details] [Accept New Key] [Cancel]
```

Only accept the new key if you know why the host key changed (e.g., server was rebuilt).

## Troubleshooting Common Issues

### Connection Timeout

**Symptoms:** "Connection timed out" or long delays

**Solutions:**
1. Verify host and port are correct
2. Check firewall rules (port 22 open)
3. Test with CLI: `ssh -v user@host`
4. Check if VPN is required

### Authentication Failed

**Symptoms:** "Authentication failed" or "Permission denied"

**For Password Auth:**
- Verify username and password
- Check if account is locked or expired

**For Key Auth:**
- Verify key file exists and is readable
- Check key permissions (should be 600)
- Ensure public key is in server's `~/.ssh/authorized_keys`

**For Agent Auth:**
- Verify `SSH_AUTH_SOCK` is set: `echo $SSH_AUTH_SOCK`
- Check key is loaded: `ssh-add -l`
- Reload key if needed: `ssh-add ~/.ssh/id_ed25519`

### Host Key Verification Failed

**Symptoms:** "Host key verification failed"

**Solutions:**
1. Check if server was recently rebuilt
2. Verify fingerprint with server admin
3. Remove old entry: `ssh-keygen -R hostname`
4. Reconnect and accept new key

### SFTP Operations Fail

**Symptoms:** Can connect but file operations fail

**Solutions:**
1. Verify SFTP is enabled on server (`Subsystem sftp` in sshd_config)
2. Check disk space on remote server
3. Verify permissions on project directory
4. Try manual SFTP: `sftp user@host`

### Git Operations Fail on Remote

**Symptoms:** Git commands return errors

**Solutions:**
1. Ensure Git is installed on remote server: `ssh user@host git --version`
2. Check repository permissions
3. Verify Git config (user.name, user.email) on remote
4. For private repos, ensure SSH agent forwarding or deploy keys

### Slow File Operations

**Symptoms:** File browsing or editing is slow

**Solutions:**
1. Check network latency: `ping server`
2. Consider connection multiplexing in ~/.ssh/config:
```
Host server
    ControlMaster auto
    ControlPath ~/.ssh/sockets/%r@%h-%p
    ControlPersist 600
```

## Security Best Practices

### 1. Use SSH Keys, Not Passwords

Keys are more secure and convenient:
```bash
# Generate Ed25519 key (recommended)
ssh-keygen -t ed25519 -C "emdash@workstation"

# Copy to server
ssh-copy-id user@server
```

### 2. Protect Private Keys

- Never commit private keys to Git
- Use strong passphrases for keys
- Store keys in `~/.ssh/` with 600 permissions
- Use hardware security keys (YubiKey) for high-security environments

### 3. Verify Host Keys

Always verify host key fingerprints on first connection. For known servers, distribute fingerprints securely:

```bash
# Get server fingerprint
ssh-keyscan -t ed25519 server.example.com
```

### 4. Use SSH Config for Advanced Options

Create `~/.ssh/config` for server-specific settings:

```
Host prod-server
    HostName prod.example.com
    User deploy
    IdentityFile ~/.ssh/prod_ed25519
    StrictHostKeyChecking accept-new
    ServerAliveInterval 60

Host dev-server
    HostName 192.168.1.100
    User developer
    ForwardAgent yes
```

### 5. Limit Agent Forwarding

Only enable agent forwarding when needed:
```
Host trusted-server
    ForwardAgent yes
```

### 6. Regular Key Rotation

Rotate SSH keys periodically:
- Generate new keys every 6-12 months
- Remove old keys from `authorized_keys`
- Update Emdash connections with new key paths

### 7. Audit Connections

Review your `~/.ssh/known_hosts` periodically:
```bash
# List known hosts
ssh-keygen -l -f ~/.ssh/known_hosts

# Remove stale entries
ssh-keygen -R old-server.example.com
```

## Quick Reference

### SSH Config File Location

- **macOS/Linux:** `~/.ssh/config`
- **Windows:** `%USERPROFILE%\.ssh\config`
- **Known hosts:** `~/.ssh/known_hosts` (Windows: `%USERPROFILE%\.ssh\known_hosts`)

### Common SSH Commands

```bash
# Test connection
ssh -v user@host

# Check loaded keys
ssh-add -l

# Add key to agent
ssh-add ~/.ssh/id_ed25519

# Remove key from agent
ssh-add -d ~/.ssh/id_ed25519

# Remove host from known_hosts
ssh-keygen -R hostname

# Get server fingerprint
ssh-keyscan -t ed25519 hostname
```

### Emdash SSH Storage Locations

- **Connection configs:** Local SQLite database
- **Passwords/Passphrases:** System keychain (via keytar)
- **Host keys:** `~/.ssh/known_hosts` (shared with system SSH)
- **Private keys:** Never stored by Emdash (only paths are stored)

---

For technical details on SSH implementation, see [SSH Architecture](./ssh-architecture.md).
