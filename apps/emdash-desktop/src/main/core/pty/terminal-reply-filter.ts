// Device-Attributes / version reply sequences that xterm.js (the renderer's
// terminal) auto-generates when something queries it:
//   - DA1 reply:  ESC [ ? <params> c     e.g. ESC[?1;2c   (visible tail: 1;2c)
//   - DA2 reply:  ESC [ > <params> c     e.g. ESC[>0;276;0c (visible tail: 0;276;0c)
//   - XTVERSION:  ESC P > | <text> ST    e.g. ESC P >|XTerm(380) ESC \
// `ST` is either `ESC \` or the single-byte `0x9c`.
// Require at least one parameter (`[0-9;]+`, not `*`): a real DA reply always
// carries params, whereas the bare DA2 *query* `ESC[>c` has none. Using `*` would
// also match that query and wrongly drop it (the DA1 query `ESC[c` lacks the
// `?`/`>` leader, so it never matched either way).
const DA_REPLY = /\x1b\[[?>][0-9;]+c/g;
const XTVERSION_REPLY = /\x1bP>\|[^\x1b\x9c]*(?:\x1b\\|\x9c)/g;

/**
 * Returns the terminal input that should actually be forwarded to a tmux-backed
 * remote PTY, with *unsolicited* Device-Attributes / version replies removed.
 *
 * Why this exists: tmux probes the outer terminal on every client attach
 * (DA1/DA2/XTVERSION). Over SSH the reply round-trips through the renderer's
 * xterm.js and back slowly enough to miss tmux's post-attach read window, so
 * tmux forwards it to the focused pane and the shell echoes garbage like
 * `1;2c0;276;0c`. emdash pre-declares the terminal's capabilities to tmux via
 * `terminal-features` (see {@link buildTmuxShellLine}), so these replies are
 * redundant and safe to drop. Apply only to tmux-backed sessions: outside tmux
 * a remote app may legitimately query DA and need the reply.
 *
 * Conservative by design: a chunk is dropped only when it is composed *entirely*
 * of reply sequences. A chunk that also carries real typed input is forwarded
 * unchanged, so genuine keystrokes are never altered.
 */
export function stripUnsolicitedTerminalReplies(data: string): string {
  if (!data) return data;
  const stripped = data.replace(DA_REPLY, '').replace(XTVERSION_REPLY, '');
  return stripped.length === 0 ? '' : data;
}
