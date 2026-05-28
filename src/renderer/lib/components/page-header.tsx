import { Separator } from '../ui/separator';

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl">{title}</h2>
        <p className="text-sm text-foreground-muted">{description}</p>
      </div>
      <div className="flex flex-col gap-4">
        {children}
        <Separator />
      </div>
    </div>
  );
}
