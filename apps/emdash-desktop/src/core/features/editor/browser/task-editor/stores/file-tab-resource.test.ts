import { describe, expect, it } from 'vitest';
import { FileTabResource } from '@core/features/editor/api/browser/task-editor/stores/file-tab-resource';

describe('FileTabResource selections', () => {
  it('switches previewable files to source and exposes a one-shot selection request', () => {
    const resource = new FileTabResource({ path: 'README.md' });
    expect(resource.viewMode).toBe('preview');

    resource.requestSelection({ lineNumber: 8, startColumn: 4, endColumn: 10 });

    expect(resource.viewMode).toBe('source');
    expect(resource.selectionRequest).toEqual({
      id: 1,
      selection: { lineNumber: 8, startColumn: 4, endColumn: 10 },
    });

    resource.consumeSelectionRequest(2);
    expect(resource.selectionRequest?.id).toBe(1);
    resource.consumeSelectionRequest(1);
    expect(resource.selectionRequest).toBeNull();
  });
});
