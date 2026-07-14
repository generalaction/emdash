import { z } from 'zod';
import { defineStep, type StepDescriptor } from './descriptor';

export const gitFetchStep = defineStep({
  kind: 'git-fetch',
  args: z.object({
    remote: z.string().min(1),
    refspec: z.string().min(1).optional(),
    force: z.boolean().optional(),
    noTags: z.boolean().optional(),
    filter: z.enum(['blob:none']).optional(),
  }),
  fatal: true,
  label: (args) =>
    args.refspec ? `Fetch ${args.refspec} from ${args.remote}` : `Fetch ${args.remote}`,
});

export const ensureRemoteStep = defineStep({
  kind: 'ensure-remote',
  args: z.object({
    name: z.string().min(1),
    url: z.string().min(1),
  }),
  fatal: true,
  label: (args) => `Ensure remote ${args.name}`,
});

export const createLocalBranchStep = defineStep({
  kind: 'create-local-branch',
  args: z.object({
    branchName: z.string().min(1),
    fromRef: z.string().min(1),
    noTrack: z.boolean().optional(),
    reset: z.boolean().optional(),
  }),
  fatal: true,
  label: (args) => `Create branch ${args.branchName}`,
});

export const setBranchTrackingStep = defineStep({
  kind: 'set-branch-tracking',
  args: z.object({
    branchName: z.string().min(1),
    remote: z.string().min(1),
    remoteBranch: z.string().min(1),
  }),
  fatal: false,
  label: (args) => `Set upstream for ${args.branchName}`,
});

export const setBranchBaseStep = defineStep({
  kind: 'set-branch-base',
  args: z.object({
    branchName: z.string().min(1),
    baseRef: z.string().min(1),
  }),
  fatal: false,
  label: (args) => `Record base for ${args.branchName}`,
});

export const addWorktreeStep = defineStep({
  kind: 'add-worktree',
  args: z.object({
    branchName: z.string().min(1),
    path: z.string().min(1),
  }),
  fatal: true,
  label: (args) => `Create worktree for ${args.branchName}`,
});

export const createDirectoryStep = defineStep({
  kind: 'create-directory',
  args: z.object({
    path: z.string().min(1),
  }),
  fatal: true,
  label: (args) => `Create directory ${args.path}`,
});

export const writeFileStep = defineStep({
  kind: 'write-file',
  args: z.object({
    path: z.string().min(1),
    content: z.string(),
  }),
  fatal: true,
  label: (args) => `Write ${args.path}`,
});

export const gitCommitStep = defineStep({
  kind: 'git-commit',
  args: z.object({
    message: z.string().min(1),
    paths: z.array(z.string().min(1)).min(1),
  }),
  fatal: true,
  label: (args) => args.message,
});

export const copyPreservedFilesStep = defineStep({
  kind: 'copy-preserved-files',
  args: z.object({}),
  fatal: false,
  label: () => 'Copy preserved files',
});

export const pushBranchStep = defineStep({
  kind: 'push-branch',
  args: z.object({
    branchName: z.string().min(1),
    remote: z.string().min(1),
    setUpstream: z.boolean().optional(),
  }),
  fatal: false,
  label: (args) => `Push branch ${args.branchName}`,
});

export const removeWorktreeStep = defineStep({
  kind: 'remove-worktree',
  args: z.object({
    path: z.string().min(1),
  }),
  fatal: false,
  label: (args) => `Remove worktree ${args.path}`,
});

export const removeDirectoryStep = defineStep({
  kind: 'remove-directory',
  args: z.object({
    path: z.string().min(1),
  }),
  fatal: true,
  label: (args) => `Remove directory ${args.path}`,
});

export const deleteBranchStep = defineStep({
  kind: 'delete-branch',
  args: z.object({
    branchName: z.string().min(1),
  }),
  fatal: false,
  label: (args) => `Delete branch ${args.branchName}`,
});

export const removeRemoteStep = defineStep({
  kind: 'remove-remote',
  args: z.object({
    name: z.string().min(1),
  }),
  fatal: false,
  label: (args) => `Remove remote ${args.name}`,
});

export const gitCloneStep = defineStep({
  kind: 'git-clone',
  args: z.object({
    url: z.string().min(1),
    path: z.string().min(1),
    remoteName: z.string().min(1).optional(),
    depth: z.number().int().positive().optional(),
    noTags: z.boolean().optional(),
    filter: z.enum(['blob:none']).optional(),
  }),
  fatal: true,
  label: (args) => `Clone ${args.url}`,
});

export const runScriptStep = defineStep({
  kind: 'run-script',
  args: z.object({
    id: z.string().min(1),
    command: z.string().min(1),
    cwd: z.enum(['repo', 'worktree']).optional(),
    timeoutMs: z.number().int().positive().optional(),
    optional: z.boolean().optional(),
  }),
  fatal: (args) => !args.optional,
  label: (args) => `Run ${args.id || truncateCommand(args.command)}`,
});

export const writeSetupStampStep = defineStep({
  kind: 'write-setup-stamp',
  args: z.object({
    configHash: z.string().min(1),
  }),
  fatal: true,
  label: () => 'Write setup stamp',
});

export const stepDescriptors = [
  gitFetchStep,
  ensureRemoteStep,
  createLocalBranchStep,
  setBranchTrackingStep,
  setBranchBaseStep,
  addWorktreeStep,
  createDirectoryStep,
  writeFileStep,
  gitCommitStep,
  copyPreservedFilesStep,
  pushBranchStep,
  removeWorktreeStep,
  removeDirectoryStep,
  deleteBranchStep,
  removeRemoteStep,
  gitCloneStep,
  runScriptStep,
  writeSetupStampStep,
] as const;

type StepDescriptorUnion = (typeof stepDescriptors)[number];

export type BootstrapStep = {
  [Descriptor in StepDescriptorUnion as Descriptor['kind']]: {
    kind: Descriptor['kind'];
    args: z.infer<Descriptor['args']>;
  };
}[StepDescriptorUnion['kind']];

export type BootstrapStepKind = BootstrapStep['kind'];

const stepSchemas = stepDescriptors.map((descriptor) =>
  z.object({
    kind: z.literal(descriptor.kind),
    args: descriptor.args,
  })
) as unknown as [
  z.ZodObject<{ kind: z.ZodLiteral<string>; args: z.ZodTypeAny }>,
  ...Array<z.ZodObject<{ kind: z.ZodLiteral<string>; args: z.ZodTypeAny }>>,
];

export const bootstrapStepSchema = z.discriminatedUnion('kind', stepSchemas);

export function step<Kind extends BootstrapStepKind>(
  kind: Kind,
  args: Extract<BootstrapStep, { kind: Kind }>['args']
): Extract<BootstrapStep, { kind: Kind }> {
  return { kind, args } as Extract<BootstrapStep, { kind: Kind }>;
}

export function descriptorFor(kind: string): StepDescriptor | undefined {
  return stepDescriptors.find((descriptor) => descriptor.kind === kind);
}

function truncateCommand(command: string): string {
  return command.length > 40 ? `${command.slice(0, 37)}...` : command;
}
