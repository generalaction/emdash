import type { Strategy } from '@core/features/projects/browser/components/add-project-modal/add-project-modal';
import type { ProjectDirectoryPickerClient } from '@core/features/projects/browser/components/add-project-modal/project-directory-picker';
import { useOpenModal } from '@core/manifests/browser/modal-api';
/**
 * Web override for the local project directory selector.
 *
 * The desktop app picks local directories through a native OS dialog, which
 * does not exist in the browser. The web build replaces the dialog-trigger
 * field with a plain path input — the surrounding add-project flow already
 * validates typed paths live via `inspectProjectPath`, so manual entry keeps
 * full validation. The SSH strategy keeps its modal picker (wire-based).
 */
import { Input } from '@emdash/ui/react/primitives';

interface DirectoryFieldProps {
  strategy: Strategy;
  connectionId?: string;
  title: string;
  message: string;
  path?: string;
  getProjectsClient(): Promise<ProjectDirectoryPickerClient>;
  onPathChange: (path: string) => void;
  placeholder?: string;
  ensureDefaultRoot?: boolean;
}

export function DirectoryField({
  strategy,
  connectionId,
  path = '',
  getProjectsClient,
  onPathChange,
  placeholder = '/absolute/path/to/project',
}: DirectoryFieldProps) {
  const openDirectorySelectorModal = useOpenModal('directorySelectorModal');
  const disabled = strategy === 'ssh' && !connectionId;

  const handleChooseDirectory = async () => {
    if (strategy === 'ssh') {
      if (!connectionId) return;
      const outcome = await openDirectorySelectorModal({
        connectionId,
        initialPath: path || undefined,
        getProjectsClient,
      });
      if (outcome.success) onPathChange(outcome.data.path);
      return;
    }
    /* local strategy: manual path entry (native dialog unavailable in web) */
  };

  return strategy === 'ssh' ? (
    <button
      type="button"
      className="w-full text-left"
      disabled={disabled}
      onClick={() => void handleChooseDirectory()}
    >
      {path || placeholder}
    </button>
  ) : (
    <Input
      type="text"
      value={path}
      placeholder={placeholder}
      onChange={(event) => onPathChange(event.currentTarget.value)}
      spellCheck={false}
      autoComplete="off"
    />
  );
}
