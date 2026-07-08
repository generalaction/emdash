# Live Logs

Live logs are append-only text streams with retained tail snapshots. They are a
good fit for terminal output, build logs, and agent process output where clients
need to attach late and still see recent context.

## Server

`LiveLog` stores a bounded text buffer. `append(chunk)` emits
`{ chunk }` deltas to subscribers and updates the retained snapshot:

```ts
const server = new LiveLog({ generation: 3000, maxBufferBytes: 12 });

export function appendLine(line: string): void {
  server.append(`${line}\n`);
}
```

Options:

- `generation`: optional fixed generation, useful in tests.
- `maxBufferBytes`: retained buffer size. The default is 1 MiB.

Snapshots contain `LiveLogSnapshotData`:

```ts
type LiveLogSnapshotData = {
  baseOffset: number;
  text: string;
  truncated: boolean;
};
```

`baseOffset` is the byte offset of `text` in the logical full log. When the
server drops old bytes because `maxBufferBytes` was exceeded, `truncated` is
`true`. The server keeps at least the newest chunk even if it exceeds the byte
limit.

`reseed()` starts a new generation, clears retained text, resets `baseOffset` to
`0`, and resets sequence to `0`.

## Client

`LiveLogClient` is callback-oriented rather than state-model-oriented:

```ts
const client = new LiveLogClient({
  refetchSnapshot: fetchSnapshot,
  onReset: (data) => console.log('log reset:', data.text),
  onAppend: (chunk) => console.log('log append:', chunk),
  topic,
  instrumentation,
  logger,
});

client.seed(await fetchSnapshot());
const detach = attach((update) => client.applyUpdate(update));
```

Use `onReset` to replace rendered text and `onAppend` to append incremental
chunks. `getSnapshot()` returns the retained tail the client has applied so far.

The client resyncs on update-before-seed, generation mismatch, sequence gap, or
invalid log delta. Resync events use the same `resync` instrumentation hook as
live models.

## API Layer Usage

Contracts expose logs with `liveLog({ key })`:

```ts
const api = defineContract({
  activity: liveLog({ key: sessionKeySchema }),
});

const controller = bindContract(api, {
  activity: () => activityLogServer,
});

const activity = thin.activity.handle(session);
const detach = await activity.attach((update) => {
  console.log((update.delta as { chunk: string }).chunk);
});

detach();
```

The API layer handles topic encoding, snapshots, attachment, and detachment.
Use `createLiveLogReplica()` when a process wants a retained local buffer that can
also be served downstream.

See [../../examples/live-log/client.ts](../../examples/live-log/client.ts).
