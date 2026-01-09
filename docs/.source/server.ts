// @ts-nocheck
import * as __fd_glob_14 from '../content/docs/telemetry.mdx?collection=docs';
import * as __fd_glob_13 from '../content/docs/tasks.mdx?collection=docs';
import * as __fd_glob_12 from '../content/docs/roadmap.mdx?collection=docs';
import * as __fd_glob_11 from '../content/docs/providers.mdx?collection=docs';
import * as __fd_glob_10 from '../content/docs/parallel-agents.mdx?collection=docs';
import * as __fd_glob_9 from '../content/docs/kanban-view.mdx?collection=docs';
import * as __fd_glob_8 from '../content/docs/issues.mdx?collection=docs';
import * as __fd_glob_7 from '../content/docs/installation.mdx?collection=docs';
import * as __fd_glob_6 from '../content/docs/index.mdx?collection=docs';
import * as __fd_glob_5 from '../content/docs/diff-view.mdx?collection=docs';
import * as __fd_glob_4 from '../content/docs/contributing.mdx?collection=docs';
import * as __fd_glob_3 from '../content/docs/containerization.mdx?collection=docs';
import * as __fd_glob_2 from '../content/docs/changelog.mdx?collection=docs';
import * as __fd_glob_1 from '../content/docs/best-of-n.mdx?collection=docs';
import { default as __fd_glob_0 } from '../content/docs/meta.json?collection=docs';
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<
  typeof Config,
  import('fumadocs-mdx/runtime/types').InternalTypeConfig & {
    DocData: {};
  }
>({ doc: { passthroughs: ['extractedReferences'] } });

export const docs = await create.docs(
  'docs',
  'content/docs',
  { 'meta.json': __fd_glob_0 },
  {
    'best-of-n.mdx': __fd_glob_1,
    'changelog.mdx': __fd_glob_2,
    'containerization.mdx': __fd_glob_3,
    'contributing.mdx': __fd_glob_4,
    'diff-view.mdx': __fd_glob_5,
    'index.mdx': __fd_glob_6,
    'installation.mdx': __fd_glob_7,
    'issues.mdx': __fd_glob_8,
    'kanban-view.mdx': __fd_glob_9,
    'parallel-agents.mdx': __fd_glob_10,
    'providers.mdx': __fd_glob_11,
    'roadmap.mdx': __fd_glob_12,
    'tasks.mdx': __fd_glob_13,
    'telemetry.mdx': __fd_glob_14,
  }
);
