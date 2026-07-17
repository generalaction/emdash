import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import { useWorkspaceViewModel } from '@core/features/tasks/browser/task-view-context';
import { MAX_PREVIEW_COLUMNS, MAX_PREVIEW_ROWS, parseCsv } from '@renderer/lib/editor/csv-parser';
import { ModelStatusOverlay } from '@renderer/lib/monaco/model-status-overlay';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { useModelStatus } from '@renderer/lib/monaco/use-model';

interface CsvRendererProps {
  filePath: string;
}

/**
 * Renders a CSV file as a table preview.
 * The source/preview toggle lives in the FileContent container above this component.
 */
export const CsvRenderer = observer(function CsvRenderer({ filePath }: CsvRendererProps) {
  const { editorView } = useWorkspaceViewModel();
  const bufferUri = buildMonacoModelPath(editorView.modelRootPath, filePath);
  const modelStatus = useModelStatus(bufferUri);

  // Touch bufferVersions so this observer re-renders when the buffer is first
  // populated or updated externally before reading the non-observable model text.
  void modelRegistry.bufferVersions.get(bufferUri);
  const content = modelStatus === 'ready' ? (modelRegistry.getValue(bufferUri) ?? '') : '';
  const parsed = useMemo(() => parseCsv(content), [content]);
  const [header, ...bodyRows] = parsed.rows;
  const columnCount = Math.max(
    1,
    ...(parsed.rows.length ? parsed.rows.map((row) => row.length) : [1])
  );

  return (
    <div className="h-full w-full overflow-hidden bg-background-secondary-1">
      {modelStatus !== 'ready' ? (
        <ModelStatusOverlay status={modelStatus} />
      ) : parsed.rows.length ? (
        <div className="h-full overflow-auto">
          <table className="min-w-full border-separate border-spacing-0 cursor-text text-left text-xs">
            <thead>
              <tr>
                {normalizeRow(header ?? [], columnCount).map((cell, index) => (
                  <th
                    key={index}
                    className="text-foreground-primary sticky top-0 z-[1] max-w-80 border-r border-b border-border bg-background-secondary-2 px-3 py-2 font-medium last:pr-28"
                  >
                    <span className="block truncate">{cell || `Column ${index + 1}`}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className="odd:bg-background-secondary-1 even:bg-background-secondary-2"
                >
                  {normalizeRow(row, columnCount).map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="max-w-80 border-r border-b border-border px-3 py-1.5 align-top whitespace-pre-wrap text-foreground-secondary"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {parsed.truncatedRows > 0 || parsed.truncatedColumns > 0 ? (
            <div className="sticky bottom-0 border-t border-border bg-background-secondary-1 px-3 py-2 text-xs text-foreground-passive">
              Preview capped at{' '}
              {parsed.truncatedRows > 0 ? `${MAX_PREVIEW_ROWS.toLocaleString()} rows` : null}
              {parsed.truncatedRows > 0 && parsed.truncatedColumns > 0 ? ' and ' : null}
              {parsed.truncatedColumns > 0
                ? `${MAX_PREVIEW_COLUMNS.toLocaleString()} columns`
                : null}
              .
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-foreground-passive">
          Empty file
        </div>
      )}
    </div>
  );
});

function normalizeRow(row: string[], columnCount: number): string[] {
  if (row.length >= columnCount) return row;
  return [...row, ...Array.from({ length: columnCount - row.length }, () => '')];
}
