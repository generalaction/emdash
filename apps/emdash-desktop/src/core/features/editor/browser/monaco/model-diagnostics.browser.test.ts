import { deferred } from '@emdash/shared/testing';
import * as monaco from 'monaco-editor';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelDiagnostics } from './model-diagnostics';

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose();
  vi.useRealTimers();
});
function marker(message: string): monaco.editor.IMarkerData {
  return {
    message,
    severity: monaco.MarkerSeverity.Error,
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 2,
  };
}
function fixture() {
  vi.useFakeTimers();
  const local = { diagnostics: vi.fn(async () => [marker('local')]) };
  const error = vi.fn();
  const diagnostics = new ModelDiagnostics(monaco, local, error);
  const model = monaco.editor.createModel('text', 'plaintext');
  cleanup.push(
    () => diagnostics.dispose(),
    () => model.dispose()
  );
  return {
    model,
    local,
    diagnostics,
    error,
    messages: () =>
      monaco.editor.getModelMarkers({ resource: model.uri }).map((item) => item.message),
  };
}

it('replaces local diagnostics with host results, including an empty publication, and restores fallback', async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(500);
  expect(f.messages()).toEqual(['local']);
  f.diagnostics.publish(f.model, [marker('host')]);
  expect(f.messages()).toEqual(['host']);
  f.diagnostics.publish(f.model, []);
  await vi.advanceTimersByTimeAsync(500);
  expect(f.messages()).toEqual([]);
  expect(f.local.diagnostics).toHaveBeenCalledTimes(1);
  f.diagnostics.publish(f.model, undefined);
  await vi.advanceTimersByTimeAsync(500);
  expect(f.messages()).toEqual(['local']);
});

it('discards a local validation already in flight when the host takes ownership', async () => {
  const f = fixture();
  const pending = deferred<monaco.editor.IMarkerData[]>();
  f.local.diagnostics.mockReturnValueOnce(pending.promise);
  await vi.advanceTimersByTimeAsync(500);
  f.diagnostics.publish(f.model, [marker('host')]);
  pending.resolve([marker('obsolete local')]);
  await vi.advanceTimersByTimeAsync(500);
  expect(f.messages()).toEqual(['host']);
});

it('clears stale markers without releasing host ownership on edits', async () => {
  const f = fixture();
  f.diagnostics.publish(f.model, [marker('host')]);
  f.model.setValue('edited');
  await vi.advanceTimersByTimeAsync(500);
  expect(f.messages()).toEqual([]);
  expect(f.local.diagnostics).not.toHaveBeenCalled();
});

it('discards obsolete validation after edits and validates the new text', async () => {
  const f = fixture();
  const pending = deferred<monaco.editor.IMarkerData[]>();
  f.local.diagnostics.mockReturnValueOnce(pending.promise);
  await vi.advanceTimersByTimeAsync(500);
  f.model.setValue('new');
  pending.resolve([marker('old')]);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.messages()).toEqual([]);
  await vi.advanceTimersByTimeAsync(500);
  expect(f.messages()).toEqual(['local']);
});

it('does not publish or report late validation after a model is disposed', async () => {
  const f = fixture();
  const pending = deferred<monaco.editor.IMarkerData[]>();
  f.local.diagnostics.mockReturnValueOnce(pending.promise);
  await vi.advanceTimersByTimeAsync(500);
  f.model.dispose();
  pending.reject(new Error('late worker failure'));
  await vi.advanceTimersByTimeAsync(0);
  expect(f.error).not.toHaveBeenCalled();
  expect(f.messages()).toEqual([]);
});

it('keeps diagnostic ownership separate for simultaneous models', async () => {
  const f = fixture();
  const other = monaco.editor.createModel('other', 'plaintext');
  cleanup.push(() => other.dispose());
  f.diagnostics.publish(f.model, [marker('host')]);
  await vi.advanceTimersByTimeAsync(500);
  expect(f.messages()).toEqual(['host']);
  expect(
    monaco.editor.getModelMarkers({ resource: other.uri }).map((item) => item.message)
  ).toEqual(['local']);
});
