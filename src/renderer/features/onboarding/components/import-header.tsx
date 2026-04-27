import { Import } from 'lucide-react';

export function ImportHeader({ isLoading }: { isLoading: boolean }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center gap-4">
      <div className="flex flex-col items-center justify-center gap-5">
        <Import className="h-10 w-10" absoluteStrokeWidth strokeWidth={1.5} />
        <div className="flex flex-col items-center justify-center gap-2">
          <h1 className="text-xl text-center">
            Do you want to import projects and tasks from other Emdash versions?
          </h1>
          {isLoading ? (
            <p className="text-md text-foreground-muted text-center">
              Scanning existing Emdash data...
            </p>
          ) : (
            <p className="text-md text-foreground-muted text-center">
              Select one or more sources. Conflicting projects can be resolved before import.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
