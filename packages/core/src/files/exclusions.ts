import type { AbsPath } from './paths';

export type FileExclusionPredicate = (absPath: AbsPath) => boolean;

export const includeAllFiles: FileExclusionPredicate = () => false;
