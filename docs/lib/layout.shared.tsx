import Image from 'next/image';
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <Image
        src="/brand/icon-dark.png"
        alt="Emdash"
        width={24}
        height={24}
        className="rounded-md dark:hidden"
      />
      <Image
        src="/brand/icon-light.png"
        alt="Emdash"
        width={24}
        height={24}
        className="hidden rounded-md dark:block"
      />
      <span className="font-semibold">Emdash</span>
    </div>
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <Logo />,
    },
  };
}
