import { quoteArg } from '#primitives/exec/api';

/**
 * Git's refusal to open a repository it does not consider owned by the current user
 * (the `safe.directory` check, CVE-2022-24765), in Git's own words.
 */
export type GitDubiousOwnership = {
  /** The repository directory as Git reports it (Git for Windows uses forward slashes). */
  repositoryPath: string;
  /**
   * The exact `safe.directory` value Git suggests for this repository. Git for Windows
   * prefixes UNC paths such as `//wsl.localhost/...` with `%(prefix)/`; without it, the value
   * is read relative to Git's installation directory and never matches.
   */
  safeDirectory: string;
};

const DUBIOUS_OWNERSHIP = /^fatal: detected dubious ownership in repository at '(.*)'$/m;
// Wording of the first CVE-2022-24765 releases (Git 2.35.2 and its maintenance backports).
const LEGACY_UNSAFE_REPOSITORY = /^fatal: unsafe repository \('(.*)' is owned by someone else\)$/m;
const SUGGESTED_COMMAND = '\tgit config --global --add safe.directory ';
const PREFIX_INTERPOLATION = '%(prefix)/';
// Characters cmd.exe, PowerShell or Git Bash still expand inside double quotes.
const EXPANDED_IN_DOUBLE_QUOTES = /[$`%!"]/;

/** A command that adds a `safe.directory` value, quoted for the shells it is pasted into. */
export type SafeDirectoryCommand = {
  command: string;
  /** The command is quoted for PowerShell only; cmd.exe and Git Bash would change the value. */
  requiresPowerShell: boolean;
};

/**
 * Recognizes the ownership refusal from a Git command run with the C locale, and reads the
 * repository path and suggested `safe.directory` value from Git's message rather than
 * deriving them, because Git's matching rules differ by version and platform.
 */
export function parseGitDubiousOwnership(failure: {
  exitCode: number | null;
  stderr: string;
}): GitDubiousOwnership | null {
  if (failure.exitCode !== 128) return null;
  const stderr = failure.stderr.replace(/\r\n/g, '\n');
  const reported = DUBIOUS_OWNERSHIP.exec(stderr) ?? LEGACY_UNSAFE_REPOSITORY.exec(stderr);
  const suggestion = stderr.lastIndexOf(SUGGESTED_COMMAND);
  if (!reported || suggestion < 0) return null;
  const safeDirectory = unquoteGitArgument(
    stderr.slice(suggestion + SUGGESTED_COMMAND.length).replace(/\n+$/, '')
  );
  if (!safeDirectory) return null;
  return { repositoryPath: reported[1], safeDirectory };
}

/**
 * The command that adds a `safe.directory` value, for users who run it themselves. Git's own
 * suggestion uses POSIX quoting even on Windows, where cmd.exe (Emdash's default terminal there)
 * keeps single quotes as part of the value and stores an entry that never matches.
 *
 * Values Git for Windows reports (drive paths, and UNC paths behind `%(prefix)/`) are therefore
 * double-quoted, which groups them identically in cmd.exe, PowerShell and Git Bash; Windows paths
 * cannot contain `"`. When the path holds a character one of those shells would still expand,
 * the command falls back to PowerShell's literal single quotes.
 */
export function safeDirectoryCommand(safeDirectory: string): SafeDirectoryCommand {
  const add = 'git config --global --add safe.directory';
  if (!isGitForWindowsValue(safeDirectory)) {
    return { command: `${add} ${quoteArg(safeDirectory, 'posix')}`, requiresPowerShell: false };
  }
  const path = safeDirectory.startsWith(PREFIX_INTERPOLATION)
    ? safeDirectory.slice(PREFIX_INTERPOLATION.length)
    : safeDirectory;
  if (!EXPANDED_IN_DOUBLE_QUOTES.test(path)) {
    return { command: `${add} "${safeDirectory}"`, requiresPowerShell: false };
  }
  return { command: `${add} ${quoteArg(safeDirectory, 'powershell')}`, requiresPowerShell: true };
}

/**
 * Explains why a `safe.directory` value would trust anything other than one exact absolute
 * path, or returns null. Empty values reset the list, `*` and `/*` suffixes are wildcards,
 * and relative values are ignored by Git or resolved against its installation directory.
 */
export function safeDirectoryValueProblem(value: string): string | null {
  if (value.length === 0) return 'The safe.directory value is empty.';
  if (Array.from(value).some((char) => char.charCodeAt(0) < 0x20 || char === '\u007f')) {
    return 'The safe.directory value contains control characters.';
  }
  if (value.includes('*')) return 'The safe.directory value contains a wildcard.';
  const path = value.startsWith(PREFIX_INTERPOLATION)
    ? value.slice(PREFIX_INTERPOLATION.length)
    : value;
  if (!/^(?:\/|\\\\|[A-Za-z]:[\\/])/.test(path)) {
    return 'The safe.directory value is not an absolute path.';
  }
  if (path.split(/[\\/]/).some((segment) => segment === '.' || segment === '..')) {
    return 'The safe.directory value contains relative path segments.';
  }
  return null;
}

/** Git for Windows reports drive paths, and prefixes the UNC paths it reports with `%(prefix)/`. */
function isGitForWindowsValue(value: string): boolean {
  return /^[A-Za-z]:\//.test(value) || value.startsWith(PREFIX_INTERPOLATION);
}

/** Reverses `sq_quote_buf_pretty`; the first releases with the check printed it unquoted. */
function unquoteGitArgument(text: string): string | null {
  if (!text.startsWith("'")) return text || null;
  let value = '';
  let index = 0;
  while (index < text.length) {
    if (text[index] === "'") {
      const end = text.indexOf("'", index + 1);
      if (end < 0) return null;
      value += text.slice(index + 1, end);
      index = end + 1;
    } else if (text[index] === '\\' && index + 1 < text.length) {
      value += text[index + 1];
      index += 2;
    } else {
      return null;
    }
  }
  return value;
}
