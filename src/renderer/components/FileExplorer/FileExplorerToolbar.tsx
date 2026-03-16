import { ChevronDown, CopyMinus, FilePlus, FolderPlus, Search } from 'lucide-react';
import { Button } from '../ui/button';

interface FileExplorerToolbarProps {
  projectName: string;
  onSearch: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onCollapse: () => void;
}

export const FileExplorerToolbar: React.FC<FileExplorerToolbarProps> = ({
  projectName,
  onSearch,
  onNewFile,
  onNewFolder,
  onCollapse,
}) => {
  return (
    <div className="flex h-8 items-center justify-between border-b border-border bg-muted/10 px-2">
      <div className="flex items-center gap-1">
        {/* search button */}

        <Button variant="ghost" size="sm" onClick={onSearch} className="gap-1 text-xs">
          <Search className="h-3.5 w-3.5" />
          <span>Search</span>
        </Button>

        {/* file actions */}

        <div className="flex items-center gap-1">
          {/* new file */}
          <Button variant="ghost" size="sm" onClick={onNewFile} className="gap-1 text-xs">
            <FilePlus className="h-3.5 w-3.5" />
          </Button>

          {/* new folder */}

          <Button variant="ghost" size="sm" onClick={onNewFolder} className="gap-1 text-xs">
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>

          {/* collapsable */}

          <Button variant="ghost" size="sm" onClick={onCollapse} className="gap-1 text-xs">
            <CopyMinus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};
