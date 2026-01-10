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

  // Providers in alphabetical order for better maintenance

  if (p === 'auggie') {
    // Auggie CLI patterns
    if (/Thinking|Processing|Analyzing|Working/i.test(text)) return 'busy';
    if (/Running|Executing|Generating|Building/i.test(text)) return 'busy';
    if (/\[.*ing\]/i.test(text)) return 'busy';
    // Idle patterns
    if (/Ready|Awaiting|Press Enter|Next command/i.test(text)) return 'idle';
    if (/auggie\s*>/i.test(text)) return 'idle';
    if (/What.*\?|How can I|Please provide/i.test(text)) return 'idle';
  }

  if (p === 'charm' || p === 'crush') {
    // Charm/Crush CLI patterns
    if (/Processing|Generating|Running|Executing/i.test(text)) return 'busy';
    if (/Thinking|Working|Analyzing|Building/i.test(text)) return 'busy';
    if (/⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/i.test(text)) return 'busy'; // Spinner chars
    // Idle patterns
    if (/Ready|Awaiting|Press Enter/i.test(text)) return 'idle';
    if (/crush\s*>/i.test(text)) return 'idle';
    if (/What.*\?|Choose|Select/i.test(text)) return 'idle';
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

  if (p === 'kiro') {
    if (/Kiro CLI|Thinking\.{0,3}/i.test(text)) return 'busy';
    if (/esc\s*to\s*(cancel|interrupt)/i.test(text)) return 'busy';
    if (/Running|Working|Executing|Generating|Applying|Planning|Analyzing/i.test(text))
      return 'busy';
    if (/Ready|Awaiting|Press Enter|Next command|Kiro CLI/i.test(text)) return 'idle';
  }

  if (p === 'rovo') {
    if (/rovodev/i.test(text) && /auth|run|session|connecting/i.test(text)) return 'busy';
    if (/Thinking\.{0,3}/i.test(text)) return 'busy';
    if (/Running|Working|Executing|Generating|Applying|Planning|Analyzing/i.test(text))
      return 'busy';
    if (/Ready|Awaiting|Press Enter|Next command|rovodev/i.test(text)) return 'idle';
  }

  if (p === 'mistral') {
    // Mistral Vibe CLI patterns

    // Busy patterns
    if (/Thinking\.{0,3}/i.test(text)) return 'busy';
    if (/Processing|Generating|Running|Executing|Analyzing|Working on/i.test(text)) return 'busy';
    // Tool execution patterns
    if (/Tool:|Executing tool:|Running tool:/i.test(text)) return 'busy';
    if (/\[.*ing\]|\[.*ING\]/i.test(text)) return 'busy'; // [Running], [Processing], etc.
    // Spinner or progress indicators
    if (/[\u2800-\u28FF]/.test(text)) return 'busy'; // Braille spinner
    if (/[\u25A0-\u25FF]/.test(text) && /\d+%/.test(text)) return 'busy'; // Progress bar
    if (/⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/i.test(text)) return 'busy'; // Common spinner chars

    // Idle patterns
    // Task completion
    if (/✓|✔|Completed|Finished|Done\./i.test(text)) return 'idle';
    if (/Task completed/i.test(text)) return 'idle';

    // Input prompts
    if (/Type.*message|Enter.*prompt/i.test(text)) return 'idle';
    if (/What would you like|How can I help/i.test(text)) return 'idle';
    if (/What.*\?|Please.*:/i.test(text)) return 'idle';

    // Standard prompts
    if (/Ready|Awaiting|Press Enter|Next command/i.test(text)) return 'idle';
    if (/\bvibe\s*>/i.test(text)) return 'idle'; // Vibe prompt
    if (/›|»|>/i.test(text) && text.length < 10) return 'idle'; // Short prompt indicators

    // Confirmation prompts
    if (/\[y\/n\]|\[Y\/N\]|Continue\?/i.test(text)) return 'idle';
    if (/Approve|Reject|Cancel/i.test(text)) return 'idle';
  }

  if (p === 'kilocode') {
    // Kilocode CLI patterns

    // Busy patterns
    if (/Thinking\.{0,3}/i.test(text)) return 'busy';
    if (/Processing|Working|Generating|Analyzing|Building|Compiling|Searching/i.test(text))
      return 'busy';
    if (/Running|Executing|Applying|Planning|Investigating/i.test(text)) return 'busy';
    // Tool/action indicators
    if (/\[.*ing\]|\[.*ING\]/i.test(text)) return 'busy'; // [Running], [Processing], etc.
    // Mode-specific busy patterns
    if (/architect mode|code mode|debug mode/i.test(text) && /working|processing/i.test(text))
      return 'busy';

    // Idle patterns - EXPANDED
    // Task completion indicators
    if (/✓\s*Task Completed/i.test(text)) return 'idle';
    if (/Task Completed/i.test(text)) return 'idle';
    if (/Checkpoint Saved/i.test(text)) return 'idle';

    // Input prompts and questions
    if (/Type a message or \/command/i.test(text)) return 'idle';
    if (/What would you like to work on/i.test(text)) return 'idle';
    if (/What.*\?|How can I|Please provide/i.test(text)) return 'idle';
    if (/Hi there!/i.test(text)) return 'idle'; // Greeting response

    // Menu/help indicators
    if (/\/help for commands/i.test(text)) return 'idle';
    if (/\/mode to switch mode/i.test(text)) return 'idle';
    if (/! for shell mode/i.test(text)) return 'idle';

    // Standard prompts
    if (/Ready|Awaiting|Press Enter|Next command/i.test(text)) return 'idle';
    if (/kilocode\s*>/i.test(text)) return 'idle'; // Kilocode prompt
    if (/\[y\/n\]|\[Y\/N\]/i.test(text)) return 'idle'; // Confirmation prompts

    // UI status bar patterns (workspace info at bottom)
    if (/\(git.*worktree\)/i.test(text)) return 'idle';
    if (/xAI.*Grok/i.test(text)) return 'idle'; // Model indicator in status
  }

  if (p === 'cline') {
    // Cline CLI patterns
    if (/Thinking|Processing|Analyzing|Working/i.test(text)) return 'busy';
    if (/Running|Executing|Generating|Building/i.test(text)) return 'busy';
    if (/Applying|Planning|Searching|Evaluating/i.test(text)) return 'busy';
    // Idle patterns
    if (/Ready|Awaiting|Press Enter|Next command/i.test(text)) return 'idle';
    if (/cline\s*>/i.test(text)) return 'idle';
    if (/What.*\?|How can I|Please.*:/i.test(text)) return 'idle';
    if (/Task completed|Done\./i.test(text)) return 'idle';
  }

  if (p === 'codebuff') {
    // Codebuff CLI patterns
    if (/Thinking|Processing|Working|Analyzing/i.test(text)) return 'busy';
    if (/Generating|Building|Compiling|Running/i.test(text)) return 'busy';
    if (/Buffering|Loading|Fetching/i.test(text)) return 'busy';
    // Idle patterns
    if (/Ready|Awaiting|Press Enter/i.test(text)) return 'idle';
    if (/codebuff\s*>/i.test(text)) return 'idle';
    if (/What.*\?|Enter.*command/i.test(text)) return 'idle';
  }

  if (p === 'continue' || p === 'cn') {
    // Continue CLI patterns
    if (/Thinking|Processing|Analyzing|Working/i.test(text)) return 'busy';
    if (/Running|Executing|Generating|Applying/i.test(text)) return 'busy';
    if (/Continuing|Resuming|Loading/i.test(text)) return 'busy';
    // Idle patterns
    if (/Ready|Awaiting|Press Enter/i.test(text)) return 'idle';
    if (/cn\s*>|continue\s*>/i.test(text)) return 'idle';
    if (/What.*\?|How can I|Next step/i.test(text)) return 'idle';
  }

  if (p === 'cursor') {
    // Cursor CLI patterns
    if (/^[\s\S]*?Generating\.?/im.test(text)) return 'busy';
    if (/\bWorking\b|\bExecuting\b|\bRunning\b/i.test(text)) return 'busy';
    if (/Add a follow-up/i.test(text)) return 'idle';
    if (/Auto\s*[\r\n]+\s*\/\s*commands/i.test(text)) return 'idle';
  }

  if (p === 'goose') {
    // Goose CLI patterns
    if (/Thinking|Processing|Analyzing|Working/i.test(text)) return 'busy';
    if (/Running|Executing|Generating|Planning/i.test(text)) return 'busy';
    if (/Investigating|Searching|Building/i.test(text)) return 'busy';
    // Idle patterns
    if (/Ready|Awaiting|Press Enter/i.test(text)) return 'idle';
    if (/goose\s*>/i.test(text)) return 'idle';
    if (/What.*\?|How can I|Choose/i.test(text)) return 'idle';
    if (/Session.*started|Session.*resumed/i.test(text)) return 'idle';
  }

  if (p === 'qwen') {
    // Qwen Code CLI patterns
    if (/Thinking|Processing|Analyzing|Working/i.test(text)) return 'busy';
    if (/Running|Executing|Generating|Compiling/i.test(text)) return 'busy';
    if (/Computing|Calculating|Optimizing/i.test(text)) return 'busy';
    if (/\[.*ing\]/i.test(text)) return 'busy';
    // Idle patterns
    if (/Ready|Awaiting|Press Enter|Next command/i.test(text)) return 'idle';
    if (/qwen\s*>/i.test(text)) return 'idle';
    if (/What.*\?|How can I|Please.*:/i.test(text)) return 'idle';
    if (/Task completed|Finished/i.test(text)) return 'idle';
  }

  // Generic signals
  if (/esc\s*to\s*(cancel|interrupt)/i.test(text)) return 'busy';
  if (/(^|\b)(Generating|Working|Executing|Running|Applying|Thinking)(\b|\.)/i.test(text))
    return 'busy';
  if (/Add a follow-up|Ready|Awaiting|Press Enter|Next command/i.test(text)) return 'idle';
  return 'neutral';
}
