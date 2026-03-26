export interface StripAnsiOptions {
  stripCsi?: boolean;
  includePrivateCsiParams?: boolean;
  stripOscBell?: boolean;
  stripOscSt?: boolean;
  stripOtherEscapes?: boolean;
  stripCarriageReturn?: boolean;
  stripTrailingNewlines?: boolean;
}

const CSI_RE = /\x1b\[[0-9;]*[ -/]*[@-~]/g;
const CSI_PRIVATE_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

export function stripAnsi(input: string, options: StripAnsiOptions = {}): string {
  const {
    stripCsi = true,
    includePrivateCsiParams = false,
    stripOscBell = true,
    stripOscSt = false,
    stripOtherEscapes = false,
    stripCarriageReturn = false,
    stripTrailingNewlines = false,
  } = options;

  let output = input;

  if (stripCsi) {
    output = output.replace(includePrivateCsiParams ? CSI_PRIVATE_RE : CSI_RE, '');
  }

  if (stripOscBell) {
    output = output.replace(/\x1b\][^\x07]*\x07/g, '');
  }

  if (stripOscSt) {
    output = output.replace(/\x1b\][^\x1b]*\x1b\\/g, '');
  }

  if (stripOtherEscapes) {
    output = output.replace(/\x1b[A-Za-z]/g, '');
  }

  if (stripCarriageReturn) {
    output = output.replace(/\r/g, '');
  }

  if (stripTrailingNewlines) {
    output = output.replace(/[\r\n]+$/g, '');
  }

  return output;
}

/**
 * Aggressively strip all escape sequences for prompt detection.
 *
 * DCS (\x1bP...\x1b\\) and ST-terminated OSC (\x1b]...\x1b\\) sequences are
 * removed BEFORE BEL-terminated OSC (\x1b]...\x07). Otherwise the greedy BEL
 * regex matches from an ST-terminated \x1b] all the way to a distant \x07,
 * consuming visible text in between (e.g. the entire fish shell prompt).
 */
export function stripForPromptDetection(input: string): string {
  return (
    input
      // 1. DCS sequences: \x1bP ... \x1b\\
      .replace(/\x1bP[^\x1b]*\x1b\\/g, '')
      // 2. ST-terminated OSC: \x1b] ... \x1b\\  (must precede BEL-terminated OSC)
      .replace(/\x1b\][^\x1b]*\x1b\\/g, '')
      // 3. Now safe to strip CSI, BEL-terminated OSC, and remaining sequences
      .replace(CSI_PRIVATE_RE, '') // CSI (including private params)
      .replace(/\x1b\][^\x07]*\x07/g, '') // OSC-BEL
      .replace(/\x1b[()#][A-Za-z0-9]/g, '') // charset designation (\x1b(B etc.)
      .replace(/\x1b[A-Za-z=><]/g, '') // simple ESC sequences (\x1bM, \x1b=, etc.)
      .replace(/\r/g, '') // carriage returns
  );
}
