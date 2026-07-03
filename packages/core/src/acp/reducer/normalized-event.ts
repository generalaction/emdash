/**
 * The internal normalized event type consumed by the AcpTranscriptParser reducer.
 *
 * NormalizedEvent is a delta/chunk — it represents a single ACP notification
 * after baseline decoding and optional provider enrichment. It is NEVER stored,
 * transported, or exported to consumers; it is the parser's private intermediate
 * type between the baseline decoder, optional EnrichHook, and the item fold.
 *
 * Contrast with TranscriptItem (accumulated materialized state).
 */

import type {
  AvailableCommand,
  SessionConfigOption,
  SessionUpdate,
} from '@agentclientprotocol/sdk';
import type { AttachmentRef } from '../models/attachments';
import type { SessionUsage } from '../models/config';
import type { TranscriptPlanEntryInput } from '../models/plan';

export type NormalizedDiff = {
  path: string;
  oldText: string | null;
  newText: string;
};

export type NormalizedToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type NormalizedEvent =
  | {
      kind: 'message';
      role: 'user' | 'assistant';
      /**
       * Provider-assigned message id. Null when the provider omitted it; the reducer
       * synthesizes a stable segment id before folding the transcript item.
       */
      messageId: string | null;
      text: string;
      /** Attachment references for user messages submitted with images. */
      attachments?: AttachmentRef[];
    }
  | {
      kind: 'thinking';
      messageId: string | null;
      text: string;
    }
  | {
      kind: 'tool_call';
      toolCallId: string;
      title: string;
      /** ACP ToolKind passthrough ('edit', 'execute', 'read', 'think', ...). */
      toolKind: string | null;
      status: NormalizedToolStatus | null;
      /**
       * Parent tool call id for nested subagent invocations.
       * Null in the baseline; providers promote vendor _meta via EnrichHook.
       */
      parentToolCallId: string | null;
      diffs: NormalizedDiff[];
    }
  | {
      kind: 'subagent';
      toolCallId: string;
      title: string;
      status: NormalizedToolStatus | null;
      parentToolCallId: string | null;
      inputSummary?: string;
      background?: boolean;
      agentId?: string;
      outputFile?: string;
    }
  | {
      kind: 'subagent_update';
      toolCallId?: string;
      agentId?: string;
      status: NormalizedToolStatus;
      summary?: string;
      outputFile?: string;
    }
  | {
      kind: 'search';
      toolCallId: string;
      query: string;
      status: NormalizedToolStatus | null;
      parentToolCallId: string | null;
      matchCount?: number;
    }
  | {
      kind: 'mcp_tool';
      toolCallId: string;
      server?: string;
      tool: string;
      status: NormalizedToolStatus | null;
      parentToolCallId: string | null;
      inputSummary?: string;
    }
  | {
      kind: 'web_fetch';
      toolCallId: string;
      url: string;
      title?: string;
      status: NormalizedToolStatus | null;
      parentToolCallId: string | null;
    }
  | {
      kind: 'tool_update';
      toolCallId: string;
      title: string | null;
      toolKind: string | null;
      status: NormalizedToolStatus | null;
      parentToolCallId: string | null;
      diffs: NormalizedDiff[];
    }
  | {
      kind: 'plan';
      entries: TranscriptPlanEntryInput[];
    }
  | {
      /** Full config option array from config_option_update. */
      kind: 'config';
      options: ReadonlyArray<SessionConfigOption>;
    }
  | {
      /** Selected mode id from current_mode_update. */
      kind: 'mode_selected';
      modeId: string;
    }
  | {
      /** Full available command list from available_commands_update. */
      kind: 'commands';
      commands: ReadonlyArray<AvailableCommand>;
    }
  | {
      /** Usage figures from usage_update. */
      kind: 'usage';
      usage: SessionUsage;
    }
  | {
      /** Session title from session_info_update. */
      kind: 'title';
      title: string;
    }
  | { kind: 'ignored' };

/**
 * An optional enrichment hook that runs after baseline decoding.
 * Receives the decoded NormalizedEvent and the original raw SessionUpdate so
 * it can promote vendor _meta fields (e.g. parentToolCallId) into first-class
 * fields. Return the event unchanged if no enrichment is needed.
 */
export type EnrichHook = (event: NormalizedEvent, raw: SessionUpdate) => NormalizedEvent;
