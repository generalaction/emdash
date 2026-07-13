import { bootGitRuntimeProcess } from '@emdash/core/runtimes/git/node/process';

bootGitRuntimeProcess({
  runtime: {
    executable: process.env.EMDASH_GIT_EXECUTABLE,
  },
});
