import { cn } from '@/lib/utils';
import {
  AGENT_PROVIDERS,
  type AgentProviderId,
} from '../../../../src/shared/agent-provider-registry';

// Bundle the same provider icons the desktop app ships (src/assets/images),
// keyed by the registry's icon file names.
const iconUrls = import.meta.glob('../../../../src/assets/images/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function resolveIcon(fileName: string): string | null {
  const entry = Object.entries(iconUrls).find(([path]) => path.endsWith(`/${fileName}`));
  return entry ? entry[1] : null;
}

export function AgentBadge({ providerId }: { providerId: AgentProviderId }) {
  const provider = AGENT_PROVIDERS.find((p) => p.id === providerId);
  if (!provider) return null;

  const icon = provider.icon ? resolveIcon(provider.icon) : null;
  const iconDark = provider.iconDark ? resolveIcon(provider.iconDark) : null;

  return (
    <span className="inline-flex items-center gap-[7px] text-[13px] text-foreground">
      {icon ? (
        <picture
          className={cn('inline-flex size-4 flex-none', provider.invertInDark && 'dark:invert')}
        >
          {iconDark ? <source srcSet={iconDark} media="(prefers-color-scheme: dark)" /> : null}
          <img
            src={icon}
            alt=""
            width={16}
            height={16}
            className="block size-4 rounded-[3px] object-contain"
          />
        </picture>
      ) : null}
      {provider.name}
    </span>
  );
}
