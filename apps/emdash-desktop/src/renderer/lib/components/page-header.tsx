import { Separator } from '../ui/separator';

export function PageHeader({
  title,
  description,
  children,
  sticky = false,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
  sticky?: boolean;
}) {
  const body = (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 [-webkit-app-region:drag]">
        <h2 className="text-xl">{title}</h2>
        <p className="text-sm text-foreground-muted">{description}</p>
      </div>
      <div className="flex flex-col gap-4 [-webkit-app-region:no-drag]">
        {children}
        <Separator />
      </div>
    </div>
  );

  if (!sticky) return body;

  return (
    <div className="sticky top-0 z-10 bg-background pt-10 [-webkit-app-region:drag]">{body}</div>
  );
}
