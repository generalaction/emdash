// @ts-nocheck
import { browser } from 'fumadocs-mdx/runtime/browser';
import type * as Config from '../source.config';

const create = browser<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();
const browserCollections = {
  docs: create.doc("docs", {"best-of-n.mdx": () => import("../content/docs/best-of-n.mdx?collection=docs"), "changelog.mdx": () => import("../content/docs/changelog.mdx?collection=docs"), "containerization.mdx": () => import("../content/docs/containerization.mdx?collection=docs"), "contributing.mdx": () => import("../content/docs/contributing.mdx?collection=docs"), "diff-view.mdx": () => import("../content/docs/diff-view.mdx?collection=docs"), "index.mdx": () => import("../content/docs/index.mdx?collection=docs"), "installation.mdx": () => import("../content/docs/installation.mdx?collection=docs"), "issues.mdx": () => import("../content/docs/issues.mdx?collection=docs"), "kanban-view.mdx": () => import("../content/docs/kanban-view.mdx?collection=docs"), "parallel-agents.mdx": () => import("../content/docs/parallel-agents.mdx?collection=docs"), "providers.mdx": () => import("../content/docs/providers.mdx?collection=docs"), "roadmap.mdx": () => import("../content/docs/roadmap.mdx?collection=docs"), "tasks.mdx": () => import("../content/docs/tasks.mdx?collection=docs"), "telemetry.mdx": () => import("../content/docs/telemetry.mdx?collection=docs"), }),
};
export default browserCollections;