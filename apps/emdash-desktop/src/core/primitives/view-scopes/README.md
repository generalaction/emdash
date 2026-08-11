# View Scopes

View scopes define hierarchical command contexts independently of navigation.
A scope definition declares its validated params, command set, activation mode,
and optional traits. A runtime implementation binds each declared command to
availability and execution behavior.

```ts
const taskViewScope = defineViewScope({
  id: 'view.task',
  params: z.object({ projectId: z.string(), taskId: z.string() }),
  commands: [archiveTaskCommand],
  activation: 'logical',
  key: ({ taskId }) => taskId,
});
```

Scope params identify the context, such as the current task. Command input
contains invocation-specific arguments, such as a new branch name. A command
binding closes over scope params and receives validated command input.

Logical scopes can be resolved by ref even when no component is mounted. Focus
scopes depend on live component state and participate only while mounted.
