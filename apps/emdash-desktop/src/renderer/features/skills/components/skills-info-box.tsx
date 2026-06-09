import { ExternalLink } from '@renderer/lib/components/external-link';
import { Alert, AlertDescription } from '@renderer/lib/ui/alert';

export function SkillsInfoBox() {
  return (
    <Alert>
      <AlertDescription>
        Skills from the{' '}
        <ExternalLink
          href="https://github.com/openai/skills"
          className="decoration-muted-foreground/40 font-medium text-foreground underline underline-offset-2 hover:decoration-foreground"
        >
          OpenAI
        </ExternalLink>{' '}
        and{' '}
        <ExternalLink
          href="https://github.com/anthropics/skills"
          className="decoration-muted-foreground/40 font-medium text-foreground underline underline-offset-2 hover:decoration-foreground"
        >
          Anthropic
        </ExternalLink>{' '}
        catalogs. Install a skill to make it available across all your coding agents. Skills follow
        the open{' '}
        <ExternalLink
          href="https://agentskills.io"
          className="decoration-muted-foreground/40 font-medium text-foreground underline underline-offset-2 hover:decoration-foreground"
        >
          Agent Skills
        </ExternalLink>{' '}
        standard. If you want to use skills from another library, feel free to let us know through
        the feedback modal.
      </AlertDescription>
    </Alert>
  );
}
