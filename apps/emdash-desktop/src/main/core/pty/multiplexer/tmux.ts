import {
  buildTmuxShellLine,
  killTmuxSession,
  makeTmuxSessionName,
} from '@main/core/pty/tmux-session-name';
import type { MultiplexerBackend } from './types';

export const tmuxBackend: MultiplexerBackend = {
  id: 'tmux',
  makeSessionName: makeTmuxSessionName,
  buildAttachShellLine: buildTmuxShellLine,
  killSession: killTmuxSession,
};
