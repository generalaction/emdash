import { z } from 'zod';
import { defineStep, type StepDescriptor, type StepFacts } from './descriptor';

export const gitFetchStep = defineStep({
  kind: 'git-fetch',
  args: z.object({
    remote: z.string().min(1),
    refspec: z.string().min(1).optional(),
    force: z.boolean().optional(),
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
  teardown: (args, facts) =>
    facts.created ? [{ kind: 'remove-remote', args: { name: args.name } }] : [],
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
  teardown: (args, facts) =>
    facts.created ? [{ kind: 'delete-branch', args: { branchName: args.branchName } }] : [],
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
  }),
  fatal: true,
  label: (args) => `Create worktree for ${args.branchName}`,
  teardown: (_args, facts) =>
    facts.created && facts.path ? [{ kind: 'remove-worktree', args: { path: facts.path } }] : [],
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

export const stepDescriptors = [
  gitFetchStep,
  ensureRemoteStep,
  createLocalBranchStep,
  setBranchTrackingStep,
  setBranchBaseStep,
  addWorktreeStep,
  copyPreservedFilesStep,
  pushBranchStep,
  removeWorktreeStep,
  deleteBranchStep,
  removeRemoteStep,
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

export function teardownStepsFor(kind: string, args: unknown, facts: StepFacts): BootstrapStep[] {
  const descriptor = descriptorFor(kind);
  if (!descriptor?.teardown) return [];
  const parsedArgs = descriptor.args.parse(args);
  return descriptor.teardown(parsedArgs, facts) as BootstrapStep[];
}
