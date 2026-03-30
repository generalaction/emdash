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
    // Strip remaining single-byte escape sequences (Fe/Fp/Fs: \e0-\e~ range)
    // while preserving multi-byte sequence openers: \e[ (CSI) and \e] (OSC)
    output = output.replace(/\x1b[^[\]]/g, '');
  }

  if (stripCarriageReturn) {
    output = output.replace(/\r/g, '');
  }

  if (stripTrailingNewlines) {
    output = output.replace(/[\r\n]+$/g, '');
  }

  return output;
}
