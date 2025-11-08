export type ActivitySignal = 'busy' | 'idle' | 'neutral';

function stripAnsi(s: string): string {
  // Remove ANSI escape codes and carriage returns
  return s
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\r/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '');
}

export function classifyActivity(
  provider: string | null | undefined,
  chunk: string
): ActivitySignal {
  let text = (chunk || '').toString();
  text = stripAnsi(text);
  if (!text) return 'neutral';

  const p = (provider || '').toLowerCase();

  if (p === 'cursor') {
    if (/^[\s\S]*?Generating\.?/im.test(text)) return 'busy';
    if (/\bWorking\b|\bExecuting\b|\bRunning\b/i.test(text)) return 'busy';
    if (/Add a follow-up/i.test(text)) return 'idle';
    if (/Auto\s*[\r\n]+\s*\/\s*commands/i.test(text)) return 'idle';
  }

  if (p === 'claude') {
    // Busy cues seen in Claude Code CLI
    if (/esc\s*to\s*interrupt/i.test(text)) return 'busy';
    if (
      /wrangling|crafting|thinking|reasoning|analyzing|planning|reading|scanning|applying/i.test(
        text
      )
    )
      return 'busy';
    // Idle cues
    if (/Ready|Awaiting|Next command|Use \/login/i.test(text)) return 'idle';
  }

  if (p === 'codex') {
    // Busy cues: generic explicit signal while generating
    if (/Esc to interrupt/i.test(text)) return 'busy';
    // Busy cues: active response lines often include a timer (e.g., 43s or 1m12s)
    if (/\(\s*(?:\d+\s*m\s*)?\d+\s*s\s*•\s*Esc to interrupt\s*\)/i.test(text)) return 'busy';
    if (/Responding to\b/i.test(text)) return 'busy';
    if (
      /Executing|Running|Thinking|Working|Analyzing|Identifying|Inspecting|Summarizing|Refactoring|Applying|Updating|Generating|Scanning|Parsing|Checking/i.test(
        text
      )
    )
      return 'busy';
    // Idle footers/prompts
    if (/Ready|Awaiting input|Press Enter/i.test(text)) return 'idle';
    if (/\b\/(status|approvals|model)\b/i.test(text)) return 'idle';
    if (/send\s+\S*\s*newline|transcript|quit/i.test(text)) return 'idle';
  }

  if (p === 'copilot') {
    if (/Thinking|Working|Generating/i.test(text)) return 'busy';
    if (
      /Ready|Press Enter|Next step/i.test(text) ||
      /Do you want to/i.test(text) ||
      /Confirm with number keys/i.test(text) ||
      /approve all file operations/i.test(text) ||
      /Yes, and approve/i.test(text)
    )
      return 'idle';
  }

  if (p === 'gemini' || p === 'droid') {
    // Gemini/Droid "esc to cancel" during generation
    if (/esc\s*to\s*cancel/i.test(text)) return 'busy';
    // Common progress words
    if (/Thinking\.{0,3}/i.test(text)) return 'busy';
    if (/[\u2800-\u28FF]/.test(text) && /Thinking/i.test(text)) return 'busy';
    if (/Running|Working|Executing|Generating|Applying|Planning|Analyzing/i.test(text))
      return 'busy';
    if (/Ready|Awaiting|Press Enter/i.test(text)) return 'idle';
  }

  if (p === 'amp') {
    // Amp CLI busy cues observed in UI: "Thinking...", "waiting for response", and "esc to cancel"
    if (/Thinking\.{0,3}/i.test(text)) return 'busy';
    if (/waiting\s+for\s+response/i.test(text)) return 'busy';
    if (/esc\s*to\s*cancel/i.test(text)) return 'busy';
    // Idle cues: generic ready prompts
    if (/Ready|Awaiting|Press Enter|Next command|Type your message/i.test(text)) return 'idle';
  }

  if (p === 'opencode') {
    // OpenCode CLI default TUI when run without args; similar cues to AMP
    if (/Thinking\.{0,3}/i.test(text)) return 'busy';
    if (/waiting\s+for\s+response/i.test(text)) return 'busy';
    if (/esc\s*to\s*cancel/i.test(text)) return 'busy';
    if (/Ready|Awaiting|Press Enter|Next command|Type your message/i.test(text)) return 'idle';
  }

  if (p === 'kimi') {
    // Kimi CLI (Moonshot AI) technical preview: generic cues
    if (/Thinking\.{0,3}/i.test(text)) return 'busy';
    if (/esc\s*to\s*(cancel|interrupt)/i.test(text)) return 'busy';
    if (/Running|Working|Executing|Generating|Applying|Planning|Analyzing/i.test(text))
      return 'busy';
    if (/Ready|Awaiting|Press Enter|Next command|\/help|\/setup/i.test(text)) return 'idle';
  }

  // Generic signals
  if (/esc\s*to\s*(cancel|interrupt)/i.test(text)) return 'busy';
  if (/(^|\b)(Generating|Working|Executing|Running|Applying|Thinking)(\b|\.)/i.test(text))
    return 'busy';
  if (/Add a follow-up|Ready|Awaiting|Press Enter|Next command/i.test(text)) return 'idle';
  return 'neutral';
}
