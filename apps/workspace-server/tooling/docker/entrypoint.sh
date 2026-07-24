#!/bin/bash
set -euo pipefail

readonly DEVUSER_HOME=/home/devuser
readonly INSTALL_ROOT="$DEVUSER_HOME/.emdash/workspace-server"
readonly ARTIFACT_ROOT=/opt/emdash-artifacts

fail() {
  printf 'workspace-remote: %s\n' "$1" >&2
  exit 1
}

artifact_architecture() {
  case "$(dpkg --print-architecture)" in
    amd64)
      printf 'x64\n'
      ;;
    arm64)
      printf 'arm64\n'
      ;;
    *)
      fail "unsupported container architecture: $(dpkg --print-architecture)"
      ;;
  esac
}

newest_artifact() {
  local architecture="$1"
  local candidate
  local newest=''

  for candidate in "$ARTIFACT_ROOT"/emdash-workspace-server-*-linux-"$architecture".tar.gz; do
    if [[ ! -f "$candidate" ]]; then
      continue
    fi
    if [[ -z "$newest" || "$candidate" -nt "$newest" ]]; then
      newest="$candidate"
    fi
  done

  if [[ -z "$newest" ]]; then
    fail "no linux-$architecture artifact found under $ARTIFACT_ROOT"
  fi
  printf '%s\n' "$newest"
}

preinstall_workspace_server() {
  local architecture
  local archive
  local archive_name
  local version
  local version_directory
  local staging_directory
  local next_link

  architecture="$(artifact_architecture)"
  archive="$(newest_artifact "$architecture")"
  archive_name="${archive##*/}"
  version="${archive_name#emdash-workspace-server-}"
  version="${version%-linux-$architecture.tar.gz}"
  if [[ ! "$version" =~ ^[0-9A-Za-z][0-9A-Za-z._+-]*$ ]]; then
    fail "could not determine a safe version from $archive_name"
  fi

  version_directory="$INSTALL_ROOT/versions/$version"
  staging_directory="$INSTALL_ROOT/staging/.install-$version-$$"
  next_link="$INSTALL_ROOT/.current-$version-$$"
  install -d -o devuser -g devuser \
    "$INSTALL_ROOT" "$INSTALL_ROOT/versions" "$INSTALL_ROOT/staging" "$INSTALL_ROOT/run"
  if [[ -d "$version_directory" ]]; then
    if [[ ! -x "$version_directory/bin/emdash-workspace-server" ]]; then
      fail "existing workspace-server $version installation is incomplete"
    fi
    rm -f "$next_link"
    ln -s "versions/$version" "$next_link"
    mv -Tf "$next_link" "$INSTALL_ROOT/current"
    chown -h devuser:devuser "$INSTALL_ROOT/current"
    printf 'workspace-remote: using existing %s installation\n' "$version"
    return
  fi
  rm -rf "$staging_directory"
  mkdir -p "$staging_directory"
  if ! tar \
    --extract \
    --gzip \
    --file "$archive" \
    --strip-components=1 \
    --directory "$staging_directory" \
    --warning=no-unknown-keyword; then
    rm -rf "$staging_directory"
    fail "failed to extract $archive_name"
  fi
  if [[ ! -x "$staging_directory/bin/emdash-workspace-server" ]]; then
    rm -rf "$staging_directory"
    fail "$archive_name does not contain the workspace-server launcher"
  fi

  mv "$staging_directory" "$version_directory"
  chown -R devuser:devuser "$version_directory"
  rm -f "$next_link"
  ln -s "versions/$version" "$next_link"
  mv -Tf "$next_link" "$INSTALL_ROOT/current"
  chown -h devuser:devuser "$INSTALL_ROOT/current"
  printf 'workspace-remote: installed %s from %s\n' "$version" "$archive_name"
}

autostart_workspace_server() {
  local launcher="$INSTALL_ROOT/current/bin/emdash-workspace-server"
  if [[ ! -x "$launcher" ]]; then
    fail 'autostart requested but no workspace server is installed at current/'
  fi

  (
    cd "$DEVUSER_HOME"
    runuser -u devuser -- env \
      HOME="$DEVUSER_HOME" \
      LOGNAME=devuser \
      USER=devuser \
      "$launcher" start --socket "$INSTALL_ROOT/run/workspace.sock"
  )
}

if [[ "${WORKSPACE_SERVER_PREINSTALL:-0}" == '1' ]]; then
  preinstall_workspace_server
fi

if [[ "${WORKSPACE_SERVER_AUTOSTART:-0}" == '1' ]]; then
  autostart_workspace_server
fi

install -d -m 0755 /run/sshd
exec /usr/sbin/sshd -D -e
