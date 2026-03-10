export function stripAnsi(data: string): string {
  return (
    data
      // CSI sequences: \x1b[ ... <letter>
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      // OSC sequences terminated by BEL (\x07)
      .replace(/\x1b\][^\x07\x1b]*\x07/g, '')
      // OSC sequences terminated by ST (\x1b\\)
      .replace(/\x1b\][^\x07\x1b]*\x1b\\/g, '')
      // DCS sequences (\x1bP ... ST)
      .replace(/\x1bP[^\x1b]*\x1b\\/g, '')
      // Remaining lone ESC + single char (SS2, SS3, etc.)
      .replace(/\x1b[^[\]P]/g, '')
  );
}
