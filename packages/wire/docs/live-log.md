# Live Logs

Live logs are append-only text streams with retained tail snapshots. They are a
good fit for terminal output, build logs, and agent process output where clients
need to attach late and still see recent context.

## Server

`LiveLogServer` stores a bounded text buffer. `append()` emits chunks to
subscribers and updates the retained snapshot. `reset()` starts a new generation
and replaces the retained text.

```ts
const server = new LiveLogServer({ generation: 3000, maxBufferBytes: 12 });

export async function fetchSnapshot(): Promise<LiveSnapshot<LiveLogSnapshotData>> {
  return server.snapshot();
}

export function attach(push: (update: LiveUpdate) => void): Unsubscribe {
  return server.subscribe(push);
}

export function appendLine(line: string): void {
  server.append(`${line}\n`);
}
```

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
true.

See [../examples/live-log/server.ts](../examples/live-log/server.ts).

## Client

`LiveLogClient` is callback-oriented rather than state-model-oriented:

```ts
const client = new LiveLogClient({
  refetchSnapshot: fetchSnapshot,
  onReset: (data) => console.log('log reset:', data),
  onAppend: (chunk) => console.log('log append:', JSON.stringify(chunk)),
});

client.seed(await fetchSnapshot());
const detach = attach((update) => client.applyUpdate(update));

appendLine('first line');
appendLine('second line');

console.log('retained log snapshot:', client.getSnapshot());
detach();
```

Use `onReset` to replace the rendered text and `onAppend` to append incremental
chunks. `getSnapshot()` returns the retained tail the client has applied so far.

See [../examples/live-log/client.ts](../examples/live-log/client.ts).

## API Layer Usage

Contracts expose logs with `liveLog({ key })`:

```ts
const api = defineContract({
  activity: liveLog({ key: sessionKeySchema }),
});

const controller = bindContract(api, {
  impl: {
    activity: () => activityLogServer,
  },
});

const binding = client.activity(session, {
  onReset: (snapshot) => console.log(snapshot.text),
  onAppend: (chunk) => console.log(chunk),
});

await binding.ready;
await binding.dispose();
```

The API layer handles topic encoding, snapshots, attachment, and detachment.
