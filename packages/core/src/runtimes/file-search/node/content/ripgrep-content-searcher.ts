import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { parsePortableRelativePath, type PortableRelativePath } from '@primitives/path/api';
import {
  CONTENT_SEARCH_DEFAULT_LIMIT,
  CONTENT_SEARCH_MAX_LINE_LENGTH,
  type ContentSearchResult,
} from '@runtimes/file-search/api';
import { createBoundExec, type BoundExec } from '@services/exec/api';
import { containsNativePath } from '../allocation/paths';
import { toExpectedFileSearchIoError } from '../api/errors';
import { DefaultFileSearchExclusions, type FileSearchExclusions } from '../exclusions';
import { errorMessage, nodeErrorCode } from '../node-errors';
import { ContentSearchAccumulator } from './content-accumulator';
import type {
  ContentSearchContext,
  ContentSearchExecutionError,
  FileContentSearcher,
  ResolvedContentSearchInput,
} from './content-searcher';
import { createRipgrepContentSearchArgs } from './ripgrep-args';
import { parseRipgrepJsonLine } from './ripgrep-json';

const MAX_STDERR_BYTES = 64 * 1024;
const MAX_JSON_LINE_BYTES = CONTENT_SEARCH_MAX_LINE_LENGTH * 4 + 64 * 1024;

type RipgrepContentSearcherOptions = Readonly<{
  executable?: string;
  env?: NodeJS.ProcessEnv;
  exclusions?: FileSearchExclusions;
}>;

export class RipgrepContentSearcher implements FileContentSearcher {
  private readonly executable: string;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly exclusions: FileSearchExclusions;

  constructor(options: RipgrepContentSearcherOptions = {}) {
    this.executable = options.executable ?? 'rg';
    this.env = options.env;
    this.exclusions = options.exclusions ?? new DefaultFileSearchExclusions();
  }

  search(
    input: ResolvedContentSearchInput,
    context: ContentSearchContext
  ): Promise<Result<ContentSearchResult, ContentSearchExecutionError>> {
    const executable = createBoundExec({
      file: this.executable,
      cwd: input.rootPath,
      env: this.env,
    });
    return runRipgrep(executable, input, context, this.exclusions);
  }
}

function runRipgrep(
  executable: BoundExec,
  input: ResolvedContentSearchInput,
  context: ContentSearchContext,
  exclusions: FileSearchExclusions
): Promise<Result<ContentSearchResult, ContentSearchExecutionError>> {
  return new Promise((resolve, reject) => {
    const accumulator = new ContentSearchAccumulator(context);
    const limit = input.limit ?? CONTENT_SEARCH_DEFAULT_LIMIT;
    const args = createRipgrepContentSearchArgs(input, exclusions);
    const child = executable.spawn(args, { signal: context.signal });
    let stdoutBuffer = '';
    let stderr = '';
    let outputError: unknown;
    let unexpectedError: unknown;
    let stoppedForLimit = false;
    let settled = false;

    const succeed = (result: Result<ContentSearchResult, ContentSearchExecutionError>): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const crash = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const stopForOutputError = (error: unknown): void => {
      if (outputError || unexpectedError) return;
      outputError = error;
      child.kill();
    };

    const acceptLine = (line: string): void => {
      if (!line.trim() || outputError || unexpectedError) return;
      let match;
      try {
        match = parseRipgrepJsonLine(line);
        if (!match) return;
        if (match.text.length > CONTENT_SEARCH_MAX_LINE_LENGTH) {
          throw new Error('ripgrep returned a line exceeding the content-search output bound');
        }
      } catch (error) {
        stopForOutputError(error);
        return;
      }

      let relativePath: PortableRelativePath;
      try {
        relativePath = normalizeResultPath(input.rootPath, match.path);
      } catch (error) {
        stopForOutputError(error);
        return;
      }

      try {
        if (accumulator.add(relativePath, match, limit) && !stoppedForLimit) {
          stoppedForLimit = true;
          child.kill();
        }
      } catch (error) {
        unexpectedError = error;
        child.kill();
      }
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (outputError || unexpectedError) return;
      stdoutBuffer += chunk;
      for (;;) {
        const newline = stdoutBuffer.indexOf('\n');
        if (newline < 0) break;
        const line = stdoutBuffer.slice(0, newline);
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (Buffer.byteLength(line) > MAX_JSON_LINE_BYTES) {
          stopForOutputError(new Error('ripgrep emitted an oversized JSON record'));
          return;
        }
        acceptLine(line);
      }
      if (Buffer.byteLength(stdoutBuffer) > MAX_JSON_LINE_BYTES) {
        stopForOutputError(new Error('ripgrep emitted an oversized JSON record'));
      }
    });
    child.stderr.on('data', (chunk: string) => {
      if (Buffer.byteLength(stderr) >= MAX_STDERR_BYTES) return;
      stderr += chunk;
      if (Buffer.byteLength(stderr) > MAX_STDERR_BYTES) {
        stderr = Buffer.from(stderr).subarray(0, MAX_STDERR_BYTES).toString('utf8');
      }
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (context.signal.aborted || error.name === 'AbortError') {
        crash(abortReason(context.signal));
        return;
      }
      succeed(err(spawnError(input, error)));
    });
    child.on('close', (code) => {
      if (settled) return;
      if (stdoutBuffer.trim() && !outputError && !unexpectedError) {
        if (Buffer.byteLength(stdoutBuffer) > MAX_JSON_LINE_BYTES) {
          outputError = new Error('ripgrep emitted an oversized JSON record');
        } else {
          acceptLine(stdoutBuffer);
        }
      }
      if (unexpectedError) {
        crash(unexpectedError);
        return;
      }
      if (outputError) {
        succeed(err(ioError(input, errorMessage(outputError, 'Unable to parse ripgrep output'))));
        return;
      }
      if (context.signal.aborted) {
        crash(abortReason(context.signal));
        return;
      }
      if (stoppedForLimit || code === 0 || code === 1) {
        try {
          succeed(ok(accumulator.result(stoppedForLimit)));
        } catch (error) {
          crash(error);
        }
        return;
      }
      const detail = stderr.trim();
      succeed(
        err(
          ioError(
            input,
            detail
              ? `ripgrep failed: ${detail}`
              : `ripgrep failed with exit code ${code ?? 'unknown'}`
          )
        )
      );
    });
    child.stdin.end();
  });
}

function normalizeResultPath(rootPath: string, ripgrepPath: string): PortableRelativePath {
  const absolutePath = path.isAbsolute(ripgrepPath)
    ? path.resolve(ripgrepPath)
    : path.resolve(rootPath, ripgrepPath);
  if (!containsNativePath(rootPath, absolutePath)) {
    throw new Error(`ripgrep returned a path outside the registered root: ${ripgrepPath}`);
  }
  const relative = path.relative(rootPath, absolutePath).split(path.sep).join('/');
  const parsed = parsePortableRelativePath(relative);
  if (!parsed.success || parsed.data === '') {
    throw new Error(`ripgrep returned an invalid file path: ${ripgrepPath}`);
  }
  return parsed.data;
}

function spawnError(
  input: ResolvedContentSearchInput,
  error: unknown
): ContentSearchExecutionError {
  const code = nodeErrorCode(error);
  if (code === 'ENOENT') {
    return {
      type: 'content-search-unavailable',
      message: 'ripgrep is not installed or could not be found',
    };
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return {
      type: 'content-search-unavailable',
      message: 'ripgrep is not executable',
    };
  }
  return (
    toExpectedFileSearchIoError(input.root, error, 'Unable to start ripgrep') ??
    ioError(input, errorMessage(error, 'Unable to start ripgrep'))
  );
}

function ioError(input: ResolvedContentSearchInput, message: string): ContentSearchExecutionError {
  return { type: 'io', root: input.root, message };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error ? signal.reason : new Error('Content search was cancelled');
}
