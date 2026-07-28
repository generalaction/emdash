import { DirectoryField as DirectoryFieldPrimitive } from '@emdash/ui/react/primitives';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { rpc } from '@renderer/lib/runtime/desktop-host-client';
import { type Strategy } from './add-project-modal';
import { type ProjectDirectoryPickerClient } from './project-directory-picker';

interface DirectoryFieldProps {
  strategy: Strategy;
  connectionId?: string;
  title: string;
  message: string;
  path?: string;
  getProjectsClient(): Promise<ProjectDirectoryPickerClient>;
  onPathChange: (path: string) => void;
  placeholder?: string;
}

export function DirectoryField({
  strategy,
  connectionId,
  title,
  message,
  onPathChange,
  path = '',
  getProjectsClient,
  placeholder = 'Select a directory',
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

    const result = await rpc.app.openSelectDirectoryDialog({
      title,
      message,
    });
    if (result) {
      onPathChange(result);
    }
  };

  return (
    <DirectoryFieldPrimitive
      path={path}
      placeholder={placeholder}
      disabled={disabled}
      onClick={() => void handleChooseDirectory()}
    />
  );
}
