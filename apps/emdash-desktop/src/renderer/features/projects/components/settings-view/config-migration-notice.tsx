import type { ProjectConfigMigration } from '@shared/core/project-settings/project-settings';

export function ConfigMigrationNotice({
  migrations,
  disabled,
  onImport,
}: {
  migrations: ProjectConfigMigration[];
  disabled: boolean;
  onImport: () => void;
}) {
  if (migrations.length === 0) return null;

  return (
    <p className="text-xs text-foreground-muted">
      Detected external project config.{' '}
      <button
        type="button"
        onClick={onImport}
        disabled={disabled}
        className="text-foreground hover:underline"
      >
        Import into Emdash
      </button>
    </p>
  );
}
