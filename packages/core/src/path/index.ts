export type { PathError } from './errors';
export {
  absoluteBasename,
  absoluteDirname,
  absoluteEquals,
  absoluteRootEquals,
  containsAbsolute,
  formatAbsolute,
  joinAbsolute,
  parseAbsolute,
  relativeSegmentsFromAbsolute,
  tryParseAbsolute,
} from './absolute';
export type { FormatAbsoluteOptions, ParseAbsoluteOptions } from './absolute';
export {
  formatPortableRelativePath,
  joinPortableRelativePath,
  parsePortableRelativePath,
  portableRelativePathBasename,
  portableRelativePathDirname,
  portableRelativePathEquals,
  portableRelativePathParent,
  portableRelativePathParts,
  ROOT_RELATIVE_PATH,
  tryParsePortableRelativePath,
} from './relative';
export type { ParseRelativeOptions } from './relative';
export {
  comparisonKeyForAbsolutePath,
  createPathProfile,
  createPathSemantics,
  normalizeForProfile,
  normalizeUnicode,
  POSIX_PATH_PROFILE,
  WIN32_PATH_PROFILE,
} from './semantics';
export type { CreatePathSemanticsOptions, PathSemantics } from './semantics';
export {
  containsHostFileRef,
  formatHostFileRef,
  formatScopedPath,
  hostFileRef,
  hostId,
  hostIdEquals,
  isHostId,
  LOCAL_HOST_ID,
  relativizeHostFileRef,
  resolveScopedPath,
  rootScopedPath,
  scopedPath,
  unsafeHostId,
} from './resource';
export {
  decodeResourceUri,
  encodeResourceUri,
  isResourceUri,
  tryDecodeResourceUri,
} from './resource-uri';
export {
  compareResourceKeys,
  resourceKeyEquals,
  resourceKeyFromFileRef,
  resourceKeyFromScopedPath,
} from './resource-key';
export {
  drivePathRootSchema,
  hostAbsolutePathSchema,
  hostFileRefSchema,
  hostIdSchema,
  hostPathRootSchema,
  pathProfileSchema,
  portableRelativePathSchema,
  posixPathRootSchema,
  resourceKeySchema,
  resourceUriSchema,
  scopedPathSchema,
  uncPathRootSchema,
} from './schemas';
export type {
  Brand,
  CaseSensitivity,
  DrivePathRoot,
  HostAbsolutePath,
  HostFileRef,
  HostId,
  HostPathRoot,
  PathProfile,
  PathStyle,
  PortableRelativePath,
  PosixPathRoot,
  ResourceKey,
  ResourceKeyOptions,
  ResourceUri,
  ScopedPath,
  UncPathRoot,
  UnicodeNormalization,
} from './types';
