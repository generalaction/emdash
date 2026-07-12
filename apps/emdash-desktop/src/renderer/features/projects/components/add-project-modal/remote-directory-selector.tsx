import { Input } from '@renderer/lib/ui/input';

interface RemoteDirectorySelectorProps {
  connectionId: string | undefined;
  value: string;
  onChange: (path: string) => void;
}

export function RemoteDirectorySelector({
  connectionId,
  value,
  onChange,
}: RemoteDirectorySelectorProps) {
  return (
    <Input
      value={value}
      disabled={!connectionId}
      placeholder="/home/user/project"
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
