import { PageLayout } from '@emdash/ui/react/patterns';

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
  return (
    <PageLayout.Header title={title} description={description} actions={children} sticky={sticky} />
  );
}
