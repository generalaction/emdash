export type ParsedGitHubRepoUrl = {
  owner: string;
  repo: string;
  normalizedUrl: string;
};

export const parseGitHubRepoUrl = (input: string): ParsedGitHubRepoUrl | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const httpsMatch = trimmed.match(
    /^https?:\/\/(?:www\.)?github\.com\/(?<owner>[\w.-]+)\/(?<repo>[\w.-]+?)(?:\.git)?(?:[/?#]|$)/i
  );
  const sshScpMatch = trimmed.match(
    /^git@github\.com:(?<owner>[\w.-]+)\/(?<repo>[\w.-]+?)(?:\.git)?$/i
  );
  const sshUrlMatch = trimmed.match(
    /^ssh:\/\/git@github\.com\/(?<owner>[\w.-]+)\/(?<repo>[\w.-]+?)(?:\.git)?\/?$/i
  );

  const match = httpsMatch ?? sshScpMatch ?? sshUrlMatch;
  const owner = match?.groups?.owner;
  const repo = match?.groups?.repo;
  if (!owner || !repo) return null;

  return {
    owner,
    repo,
    normalizedUrl: `https://github.com/${owner}/${repo}`,
  };
};

export const endsWithSeparator = (input: string) => /[\\/]\s*$/.test(input.trim());

export const stripTrailingSeparators = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^[\\/]+$/.test(trimmed)) return trimmed[0];
  return trimmed.replace(/[\\/]+$/, '');
};

export const splitPathForDisplay = (fullPath: string) => {
  const trimmed = fullPath.trim();
  if (!trimmed) return { prefix: '', name: '' };

  const normalized = stripTrailingSeparators(trimmed);
  if (normalized === '/' || normalized === '\\') return { prefix: normalized, name: '' };

  const lastSepIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (lastSepIndex === -1) return { prefix: '', name: normalized };

  return {
    prefix: normalized.slice(0, lastSepIndex + 1),
    name: normalized.slice(lastSepIndex + 1),
  };
};

export const joinPath = (base: string, segment: string, sep: '/' | '\\') => {
  const trimmedBaseRaw = base.trim();
  const trimmedSegmentRaw = segment.trim();
  const trimmedSegment = trimmedSegmentRaw.replace(/^[\\/]+/, '');

  if (!trimmedBaseRaw) return trimmedSegment;
  if (!trimmedSegment) return stripTrailingSeparators(trimmedBaseRaw);

  const trimmedBase = stripTrailingSeparators(trimmedBaseRaw);
  if (trimmedBase === '/' || trimmedBase === '\\') return `${trimmedBase}${trimmedSegment}`;

  return `${trimmedBase}${sep}${trimmedSegment}`;
};

export const deriveCloneProjectArgs = (args: {
  destinationPath: string;
  defaultBasePath: string;
  repoNameFromUrl: string | null;
}): { parentDir?: string; repoName?: string } => {
  const trimmedDestination = args.destinationPath.trim();
  const normalizedDestination = stripTrailingSeparators(trimmedDestination);
  const normalizedDefaultBase = stripTrailingSeparators(args.defaultBasePath);
  const isDefaultBase = !!normalizedDefaultBase && normalizedDestination === normalizedDefaultBase;

  if (!normalizedDestination) {
    return {
      parentDir: normalizedDefaultBase || undefined,
      repoName: args.repoNameFromUrl || undefined,
    };
  }

  if (isDefaultBase) {
    return {
      parentDir: normalizedDefaultBase,
      repoName: args.repoNameFromUrl || undefined,
    };
  }

  if (endsWithSeparator(trimmedDestination)) {
    return {
      parentDir: normalizedDestination || normalizedDefaultBase || undefined,
      repoName: args.repoNameFromUrl || undefined,
    };
  }

  const { prefix, name } = splitPathForDisplay(normalizedDestination);
  const parentDirCandidate = stripTrailingSeparators(prefix);

  return {
    parentDir: parentDirCandidate || normalizedDefaultBase || undefined,
    repoName: name || args.repoNameFromUrl || undefined,
  };
};

export const computeNextCloneDestination = (args: {
  currentDestination: string;
  defaultBasePath: string;
  repoName: string;
  sep: '/' | '\\';
  destinationTouched: boolean;
  lastAutoRepoName: string | null;
}): { shouldUpdate: boolean; nextDestination: string; nextLastAutoRepoName: string | null } => {
  const normalizedDefaultBase = stripTrailingSeparators(args.defaultBasePath);
  const trimmedCurrent = args.currentDestination.trim();
  const currentHasTrailingSep = endsWithSeparator(trimmedCurrent);
  const normalizedCurrent = stripTrailingSeparators(trimmedCurrent);

  const isDefaultBase = !!normalizedDefaultBase && normalizedCurrent === normalizedDefaultBase;
  const isEmpty = !normalizedCurrent;

  // Before we've ever auto-filled a repo name, treat the current destination as a base directory
  // (so users can edit the "base" before providing a URL, without needing to add a trailing slash).
  if (args.lastAutoRepoName == null) {
    const baseDir = isEmpty ? normalizedDefaultBase : normalizedCurrent || normalizedDefaultBase;
    if (!baseDir) {
      return {
        shouldUpdate: false,
        nextDestination: args.currentDestination,
        nextLastAutoRepoName: null,
      };
    }

    const currentRepoSegment =
      !isEmpty && !currentHasTrailingSep ? splitPathForDisplay(normalizedCurrent).name : '';
    const alreadyIncludesRepo = currentRepoSegment === args.repoName;

    return {
      shouldUpdate: true,
      nextDestination: alreadyIncludesRepo
        ? normalizedCurrent
        : joinPath(baseDir, args.repoName, args.sep),
      nextLastAutoRepoName: args.repoName,
    };
  }

  const currentRepoSegment =
    !isEmpty && !isDefaultBase && !currentHasTrailingSep
      ? splitPathForDisplay(normalizedCurrent).name
      : '';

  const shouldUpdate =
    isEmpty ||
    !args.destinationTouched ||
    currentHasTrailingSep ||
    (args.lastAutoRepoName != null && currentRepoSegment === args.lastAutoRepoName);

  if (!shouldUpdate) {
    return {
      shouldUpdate: false,
      nextDestination: args.currentDestination,
      nextLastAutoRepoName: args.lastAutoRepoName,
    };
  }

  let baseDir = normalizedDefaultBase;
  if (isDefaultBase) {
    baseDir = normalizedDefaultBase;
  } else if (currentHasTrailingSep) {
    baseDir = normalizedCurrent || normalizedDefaultBase;
  } else if (!isEmpty) {
    const { prefix } = splitPathForDisplay(normalizedCurrent);
    baseDir = stripTrailingSeparators(prefix) || normalizedDefaultBase;
  }

  return {
    shouldUpdate: true,
    nextDestination: joinPath(baseDir, args.repoName, args.sep),
    nextLastAutoRepoName: args.repoName,
  };
};
