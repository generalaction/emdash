import { bootGitRuntimeProcess } from '@emdash/runtime/git/node';

bootGitRuntimeProcess({
  runtime: {
    executable: process.env.EMDASH_GIT_EXECUTABLE,
  },
});
