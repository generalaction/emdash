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
    <span className="agent-badge">
      {icon ? (
        <picture className={provider.invertInDark ? 'agent-icon invert-dark' : 'agent-icon'}>
          {iconDark ? <source srcSet={iconDark} media="(prefers-color-scheme: dark)" /> : null}
          <img src={icon} alt="" width={16} height={16} />
        </picture>
      ) : null}
      {provider.name}
    </span>
  );
}
