import { Children, Fragment, type ReactNode } from 'react';

interface ListFilterRowProps {
  heading?: string;
  children: ReactNode;
}

export function ListFilterRow({ heading = 'Filter:', children }: ListFilterRowProps) {
  const items = Children.toArray(children).filter(Boolean);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      {heading ? <span className="text-foreground-passive">{heading}</span> : null}
      <div className="flex flex-wrap items-center gap-2">
        {items.map((child, index) => (
          <Fragment key={index}>
            {index > 0 ? <span className="text-foreground-passive/50">|</span> : null}
            {child}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
