interface EmptyStateProps {
  label: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({ label, description, action }: EmptyStateProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center bg-background p-8">
      <div className="flex max-w-xs flex-col items-center text-center">
        <h2 className="font-mono text-sm font-medium text-foreground-muted">{label}</h2>
        {description && (
          <p className="mt-1.5 text-xs leading-relaxed font-normal tracking-tight text-foreground-passive">
            {description}
          </p>
        )}
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}
