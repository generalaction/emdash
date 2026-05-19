import { Alert, AlertDescription } from '@renderer/lib/ui/alert';

export function SkillsInfoBox() {
  return (
    <Alert>
      <AlertDescription>
        Skills from the{' '}
        <a
          href="https://github.com/openai/skills"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
        >
          OpenAI
        </a>{' '}
        and{' '}
        <a
          href="https://github.com/anthropics/skills"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
        >
          Anthropic
        </a>{' '}
        catalogs. Install a skill to make it available across all your coding agents. Skills follow
        the open{' '}
        <a
          href="https://agentskills.io"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
        >
          Agent Skills
        </a>{' '}
        standard. If you want to use skills from another library, feel free to let us know through
        the feedback modal.
      </AlertDescription>
    </Alert>
  );
}
