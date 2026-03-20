import { usePrContext } from '../../state/pr-provider';
import { VirtualizedChangesList } from '../virtualized-changes-list';

export function PrFilesList({ pullRequestId }: { pullRequestId: string }) {
  const { files } = usePrContext();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-1">
      <VirtualizedChangesList
        changes={files[pullRequestId] ?? []}
        onSelectChange={handleFileClick}
        isSelected={activeFile?.path === change.path}
        onToggleSelect={handleFileClick}
        onPrefetch={handleFileClick}
        activePath={activeFile?.path}
      />
    </div>
  );
}
