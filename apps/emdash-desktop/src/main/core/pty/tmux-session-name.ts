import { createHash } from 'node:crypto';
import path from 'node:path';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { log } from '@main/lib/logger';
import { quoteShellArg } from '@main/utils/shellEscape';
import { makePtySessionId, parsePtySessionId } from '@shared/core/pty/ptySessionId';
import type { TmuxSessionConfig } from '@shared/core/pty/tmux';

export const TMUX_SESSION_PREFIX = 'emdash-';
export const TMUX_PROJECT_ID_OPTION = '@emdash_project_id';
export const TMUX_TASK_ID_OPTION = '@emdash_task_id';
export const TMUX_LEAF_ID_OPTION = '@emdash_leaf_id';
const TMUX_HISTORY_LIMIT = 100_000;
const TMUX_WORKSPACE_LABEL_LIMIT = 24;
const TMUX_ID_TOKEN_LENGTH = 10;

const TMUX_WRAPPER_SCRIPT = `preferred_name=$1
legacy_name=$2
command_line=$3
project_id=$4
task_id=$5
leaf_id=$6
identity_token=$7
lock_file=\${TMPDIR:-/tmp}/emdash-tmux-$identity_token.lock
lock_candidate=$lock_file.$$
stale_candidate=$lock_file.stale.$$
observed_candidate=$lock_file.observed.$$
cleanup_claim=$lock_file.claim.$$
cleanup_guard=$lock_file.cleanup
cleanup_marker=
guard_snapshot=$lock_file.guard-stale.$$
lock_held=0
cleanup_guard_held=0
stale_observations=0

release_lock() {
  if [ "$lock_held" = 1 ]; then
    if [ -e "$lock_file" ] && [ "$lock_file" -ef "$lock_candidate" ]; then
      rm -f "$lock_file"
    fi
    lock_held=0
  fi
  rm -f "$lock_candidate" "$stale_candidate" "$observed_candidate" "$cleanup_claim" "$guard_snapshot"
  if [ "$cleanup_guard_held" = 1 ]; then
    if [ -n "$cleanup_marker" ]; then
      rm -f "$cleanup_marker"
    fi
    rmdir "$cleanup_guard" 2>/dev/null || true
    cleanup_guard_held=0
  fi
}

find_in_rich_rows() {
  rows=$1
  fallback_name=
  tab=$(printf '\\t')
  while IFS="$tab" read -r candidate_name candidate_project candidate_task candidate_leaf; do
    if [ "$candidate_project" = "$project_id" ] && [ "$candidate_task" = "$task_id" ] && [ "$candidate_leaf" = "$leaf_id" ]; then
      if [ "$candidate_name" = "$preferred_name" ]; then
        printf '%s\\n' "$candidate_name"
        return
      fi
      if [ -z "$fallback_name" ]; then
        fallback_name=$candidate_name
      fi
    fi
  done <<EMDASH_TMUX_ROWS
$rows
EMDASH_TMUX_ROWS
  if [ -n "$fallback_name" ]; then
    printf '%s\\n' "$fallback_name"
  fi
}

find_in_option_list() {
  option_rows=$1
  candidate_project=
  candidate_task=
  candidate_leaf=
  while IFS= read -r option_row; do
    option_name=\${option_row%% *}
    option_value=\${option_row#* }
    case "$option_name" in
      ${TMUX_PROJECT_ID_OPTION}) candidate_project=$option_value ;;
      ${TMUX_TASK_ID_OPTION}) candidate_task=$option_value ;;
      ${TMUX_LEAF_ID_OPTION}) candidate_leaf=$option_value ;;
    esac
  done <<EMDASH_TMUX_OPTIONS
$option_rows
EMDASH_TMUX_OPTIONS
  [ "$candidate_project" = "$project_id" ] && [ "$candidate_task" = "$task_id" ] && [ "$candidate_leaf" = "$leaf_id" ]
}

find_with_old_tmux() {
  session_names=$(tmux list-sessions -F '#{session_name}' 2>/dev/null) || return
  fallback_name=
  while IFS= read -r candidate_name; do
    case "$candidate_name" in
      ${TMUX_SESSION_PREFIX}*) ;;
      *) continue ;;
    esac
    if [ "$candidate_name" = "$legacy_name" ]; then
      printf '%s\\n' "$candidate_name"
      return
    fi
    option_rows=$(tmux show-options -t "$candidate_name" 2>/dev/null) || continue
    if find_in_option_list "$option_rows"; then
      if [ "$candidate_name" = "$preferred_name" ]; then
        printf '%s\\n' "$candidate_name"
        return
      fi
      if [ -z "$fallback_name" ]; then
        fallback_name=$candidate_name
      fi
    fi
  done <<EMDASH_TMUX_NAMES
$session_names
EMDASH_TMUX_NAMES
  if [ -n "$fallback_name" ]; then
    printf '%s\\n' "$fallback_name"
  fi
}

find_matching_session() {
  if rich_rows=$(tmux list-sessions -F '#{session_name}\t#{${TMUX_PROJECT_ID_OPTION}}\t#{${TMUX_TASK_ID_OPTION}}\t#{${TMUX_LEAF_ID_OPTION}}' 2>/dev/null); then
    case "$rich_rows" in
      *'#{${TMUX_PROJECT_ID_OPTION}}'*) find_with_old_tmux ;;
      *)
        session_match=$(find_in_rich_rows "$rich_rows")
        if [ -n "$session_match" ]; then
          printf '%s\\n' "$session_match"
        else
          # Some older tmux releases accept the rich format but either expand
          # user options to empty strings or return a successful empty result.
          # Listing names separately distinguishes that from no server and
          # lets us recover identity through show-options.
          find_with_old_tmux
        fi
        ;;
    esac
  else
    find_with_old_tmux
  fi
}

recover_stale_cleanup_guard() {
  rm -f "$guard_snapshot"
  for guard_marker in "$cleanup_guard"/owner.*; do
    [ -e "$guard_marker" ] || continue
    if ! ln "$guard_marker" "$guard_snapshot" 2>/dev/null; then
      continue
    fi

    guard_owner=$(sed -n '1p' "$guard_snapshot" 2>/dev/null || true)
    guard_identity=$(sed -n '2p' "$guard_snapshot" 2>/dev/null || true)
    guard_owner_matches=0
    case "$guard_owner" in
      ''|*[!0-9]*) ;;
      *)
        guard_owner_candidate=$lock_file.$guard_owner
        if kill -0 "$guard_owner" 2>/dev/null && [ -e "$guard_owner_candidate" ] && [ "$guard_owner_candidate" -ef "$guard_snapshot" ]; then
          guard_current_identity=$(ps -o lstart= -p "$guard_owner" 2>/dev/null || true)
          if [ -n "$guard_identity" ] && [ "$guard_current_identity" = "$guard_identity" ]; then
            guard_owner_matches=1
          fi
        fi
        ;;
    esac

    if [ "$guard_owner_matches" = 1 ]; then
      rm -f "$guard_snapshot"
      return 1
    fi

    # owner.<pid>.<inode> is unique while this snapshot keeps the old inode
    # alive. A replacement guard therefore has a different marker path; even
    # PID reuse cannot make a competing waiter unlink the replacement marker.
    if [ -e "$guard_marker" ] && [ "$guard_marker" -ef "$guard_snapshot" ]; then
      rm -f "$guard_marker"
    fi
    case "$guard_owner" in
      ''|*[!0-9]*) ;;
      *)
        guard_owner_candidate=$lock_file.$guard_owner
        if [ -e "$guard_owner_candidate" ] && [ "$guard_owner_candidate" -ef "$guard_snapshot" ]; then
          rm -f "$guard_owner_candidate"
        fi
        ;;
    esac
    rm -f "$guard_snapshot"
  done
  rmdir "$cleanup_guard" 2>/dev/null || true
  [ ! -d "$cleanup_guard" ]
}

trap 'release_lock' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
rm -f "$lock_candidate" "$stale_candidate" "$observed_candidate" "$cleanup_claim" "$guard_snapshot"
original_umask=$(umask)
umask 077
process_identity=$(ps -o lstart= -p "$$" 2>/dev/null || true)
if ! printf '%s\\n%s\\n' "$$" "$process_identity" > "$lock_candidate"; then
  umask "$original_umask"
  exit 1
fi
umask "$original_umask"
candidate_inode=$(ls -di "$lock_candidate" 2>/dev/null | awk '{ print $1 }')
case "$candidate_inode" in
  ''|*[!0-9]*) exit 1 ;;
esac
cleanup_marker=$cleanup_guard/owner.$$.$candidate_inode

lock_attempt=0
while [ "$lock_held" = 0 ]; do
  # A stale cleaner holds this directory across validation and deletion. New
  # owners wait for it and also re-check after linking, closing the race where
  # a cleaner could otherwise unlink a replacement between -ef and rm.
  if [ -d "$cleanup_guard" ]; then
    # An empty directory can only be an interrupted guard acquisition/release.
    # rmdir cannot remove a live guard because its owner marker makes it
    # non-empty; if it catches another acquisition window, that contender's
    # marker link fails and it safely retries.
    rmdir "$cleanup_guard" 2>/dev/null || true
  fi
  if [ -d "$cleanup_guard" ]; then
    recover_stale_cleanup_guard || true
  fi
  if [ -d "$cleanup_guard" ]; then
    lock_attempt=$((lock_attempt + 1))
    if [ "$lock_attempt" -ge 300 ]; then
      exit 1
    fi
    sleep 0.1
    continue
  fi

  if ln "$lock_candidate" "$lock_file" 2>/dev/null; then
    if [ -d "$cleanup_guard" ]; then
      if [ -e "$lock_file" ] && [ "$lock_file" -ef "$lock_candidate" ]; then
        rm -f "$lock_file"
      fi
      lock_attempt=$((lock_attempt + 1))
      if [ "$lock_attempt" -ge 300 ]; then
        exit 1
      fi
      sleep 0.1
      continue
    fi
    lock_held=1
    break
  fi

  # A hard link snapshots the lock inode. If the owner is dead, remove the
  # public lock only after atomically becoming the sole stale cleaner.
  rm -f "$stale_candidate"
  if ln "$lock_file" "$stale_candidate" 2>/dev/null; then
    lock_owner=$(sed -n '1p' "$stale_candidate" 2>/dev/null || true)
    lock_identity=$(sed -n '2p' "$stale_candidate" 2>/dev/null || true)
    owner_matches=0
    case "$lock_owner" in
      ''|*[!0-9]*) ;;
      *)
        if kill -0 "$lock_owner" 2>/dev/null; then
          owner_candidate=$lock_file.$lock_owner
          current_identity=$(ps -o lstart= -p "$lock_owner" 2>/dev/null || true)
          if [ -e "$owner_candidate" ] && [ "$owner_candidate" -ef "$stale_candidate" ] && [ -n "$lock_identity" ] && [ "$current_identity" = "$lock_identity" ]; then
            owner_matches=1
          fi
        fi
        ;;
    esac

    if [ "$owner_matches" = 1 ]; then
      stale_observations=0
      rm -f "$observed_candidate"
    else
      # Do not trust kill -0 alone: a crashed wrapper's pid may already have
      # been reused by an unrelated process. Observe the same lock inode for a
      # few bounded retries before attempting the guarded cleanup below.
      if [ -e "$observed_candidate" ] && [ "$observed_candidate" -ef "$stale_candidate" ]; then
        stale_observations=$((stale_observations + 1))
      else
        rm -f "$observed_candidate"
        if ln "$stale_candidate" "$observed_candidate" 2>/dev/null; then
          stale_observations=1
        else
          stale_observations=0
        fi
      fi
      if [ "$stale_observations" -ge 3 ] && mkdir "$cleanup_guard" 2>/dev/null; then
        cleanup_guard_held=1
        if ! ln "$lock_candidate" "$cleanup_marker" 2>/dev/null; then
          rmdir "$cleanup_guard" 2>/dev/null || true
          cleanup_guard_held=0
        fi
        rm -f "$cleanup_claim"
        if [ "$cleanup_guard_held" = 1 ] && ln "$lock_file" "$cleanup_claim" 2>/dev/null && [ "$cleanup_claim" -ef "$observed_candidate" ]; then
          # The guard prevents another cleaner from acting and makes every new
          # owner back out before it becomes valid. The claimed inode therefore
          # remains the public lock until this unlink, with no check/rm gap in
          # which a replacement can appear.
          rm -f "$lock_file"
          case "$lock_owner" in
            ''|*[!0-9]*) ;;
            *)
              owner_candidate=$lock_file.$lock_owner
              if [ -e "$owner_candidate" ] && [ "$owner_candidate" -ef "$cleanup_claim" ]; then
                rm -f "$owner_candidate"
              fi
              ;;
          esac
        fi
        rm -f "$cleanup_claim" "$observed_candidate"
        stale_observations=0
        rm -f "$cleanup_marker"
        if rmdir "$cleanup_guard" 2>/dev/null; then
          cleanup_guard_held=0
        fi
      fi
    fi
    rm -f "$stale_candidate"
  fi
  lock_attempt=$((lock_attempt + 1))
  if [ "$lock_attempt" -ge 300 ]; then
    exit 1
  fi
  sleep 0.1
done

session_name=$(find_matching_session)

if [ -z "$session_name" ] && tmux has-session -t "$legacy_name" 2>/dev/null; then
  session_name=$legacy_name
fi

if [ -z "$session_name" ]; then
  session_name=$preferred_name
  if ! tmux -u new-session -d -s "$session_name" "$command_line" \\; set-option -t "$session_name" ${TMUX_PROJECT_ID_OPTION} "$project_id" \\; set-option -t "$session_name" ${TMUX_TASK_ID_OPTION} "$task_id" \\; set-option -t "$session_name" ${TMUX_LEAF_ID_OPTION} "$leaf_id"; then
    session_name=$(find_matching_session)
    if [ -z "$session_name" ]; then
      exit 1
    fi
  fi
else
  tmux set-option -t "$session_name" ${TMUX_PROJECT_ID_OPTION} "$project_id" \\; set-option -t "$session_name" ${TMUX_TASK_ID_OPTION} "$task_id" \\; set-option -t "$session_name" ${TMUX_LEAF_ID_OPTION} "$leaf_id"
fi

tmux set-option -t "$session_name" mouse on 2>/dev/null || true
tmux set-option -t "$session_name" history-limit ${TMUX_HISTORY_LIMIT} 2>/dev/null || true
release_lock
trap - HUP INT TERM
trap - EXIT
exec tmux -u attach-session -t "$session_name"`;

/**
 * Builds the POSIX wrapper used by both local and SSH-backed PTYs.
 *
 * Dynamic values are passed to `/bin/sh -c` as positional arguments instead of
 * being interpolated into the script. New sessions and their identity options
 * are created in one tmux command queue, so reconciliation can never observe a
 * friendly-named session before it has been tagged.
 */
export function buildTmuxShellLine(
  session: TmuxSessionConfig,
  commandLine: string,
  quoteArg: (value: string) => string = quoteShellArg
): string {
  const sessionId = makePtySessionId(session.projectId, session.taskId, session.leafId);
  const legacyName = makeLegacyTmuxSessionName(sessionId);
  // `-u` forces tmux into UTF-8 mode regardless of the inherited locale. GUI-launched
  // apps (e.g. Electron on macOS) often have no LANG set, so without this tmux assumes a
  // non-UTF-8 locale and mangles multibyte glyphs like Nerd-font/box-drawing characters.
  return [
    '/bin/sh',
    '-c',
    TMUX_WRAPPER_SCRIPT,
    'emdash-tmux',
    session.name,
    legacyName,
    commandLine,
    session.projectId,
    session.taskId,
    session.leafId,
    tmuxIdentityToken(sessionId),
  ]
    .map(quoteArg)
    .join(' ');
}

/** The deterministic base64url name used before friendly tmux names. */
export function makeLegacyTmuxSessionName(sessionId: string): string {
  const encoded = Buffer.from(sessionId, 'utf8').toString('base64url');
  return `${TMUX_SESSION_PREFIX}${encoded}`;
}

/**
 * Inverse of {@link makeLegacyTmuxSessionName}. Returns the encoded PTY session id, or
 * `null` if the name is not a well-formed emdash tmux session name. The
 * round-trip guard rejects anything that does not re-encode to exactly the same
 * name, so unrelated `emdash-*` sessions are never misread as ours.
 */
export function decodeLegacyTmuxSessionName(sessionName: string): string | null {
  if (!sessionName.startsWith(TMUX_SESSION_PREFIX)) return null;
  const encoded = sessionName.slice(TMUX_SESSION_PREFIX.length);
  if (!encoded) return null;
  try {
    const sessionId = Buffer.from(encoded, 'base64url').toString('utf8');
    if (makeLegacyTmuxSessionName(sessionId) !== sessionName) return null;
    return sessionId;
  } catch {
    return null;
  }
}

function workspaceLabel(workspacePath: string): string {
  const base = path.basename(workspacePath) || 'workspace';
  const sanitized = base
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return Array.from(sanitized || 'workspace')
    .slice(0, TMUX_WORKSPACE_LABEL_LIMIT)
    .join('');
}

/**
 * Build a short, recognizable name while keeping collision resistance in a
 * deterministic token. Identity is persisted separately in tmux user options.
 */
export function makeTmuxSession(sessionId: string, workspacePath: string): TmuxSessionConfig {
  const parsed = parsePtySessionId(sessionId);
  if (!parsed) throw new Error(`Invalid PTY session id: ${sessionId}`);
  const token = tmuxIdentityToken(sessionId);
  return {
    name: `${TMUX_SESSION_PREFIX}${workspaceLabel(workspacePath)}-${token}`,
    projectId: parsed.projectId,
    taskId: parsed.scopeId,
    leafId: parsed.leafId,
  };
}

function tmuxIdentityToken(sessionId: string): string {
  return createHash('sha256')
    .update(sessionId, 'utf8')
    .digest('base64url')
    .slice(0, TMUX_ID_TOKEN_LENGTH);
}

export async function killTmuxSession(ctx: IExecutionContext, sessionName: string): Promise<void> {
  try {
    await ctx.exec('tmux', ['kill-session', '-t', sessionName]);
  } catch (err) {
    log.debug('killTmuxSession: tmux session not found or already dead', {
      sessionName,
      error: String(err),
    });
  }
}
