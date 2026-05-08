import type {
  ProjectSettingsOverrideState,
  ShareableProjectSettingsWriteField,
} from '@shared/project-settings';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Field, FieldDescription, FieldTitle } from '@renderer/lib/ui/field';
import { Separator } from '@renderer/lib/ui/separator';
import { Textarea } from '@renderer/lib/ui/textarea';
import type { FormState, FormUpdate } from '../project-settings-form-model';
import { ShareableSettingTitle } from '../shareable-setting-title';

type ShareableSettingsSectionProps = {
  form: FormState;
  update: FormUpdate;
  getOverrideSources: (
    field: ShareableProjectSettingsWriteField
  ) => ProjectSettingsOverrideState[ShareableProjectSettingsWriteField];
};

export function ShareableSettingsSection({
  form,
  update,
  getOverrideSources,
}: ShareableSettingsSectionProps) {
  return (
    <>
      <Separator />

      <Field>
        <ShareableSettingTitle
          field="preservePatterns"
          overrideSources={getOverrideSources('preservePatterns')}
          onRestore={() => update('preservePatterns', '')}
        >
          Preserve patterns
        </ShareableSettingTitle>
        <FieldDescription className="text-foreground-muted">
          Gitignored and untracked files matching these glob patterns are copied from the main repo
          into each worktree. One pattern per line.
        </FieldDescription>
        <Textarea
          rows={5}
          placeholder={'.env\n.env.local\n.envrc'}
          value={form.preservePatterns}
          onChange={(e) => update('preservePatterns', e.target.value)}
        />
      </Field>

      <Separator />

      <Field>
        <ShareableSettingTitle
          field="shellSetup"
          overrideSources={getOverrideSources('shellSetup')}
          onRestore={() => update('shellSetup', '')}
        >
          Shell setup
        </ShareableSettingTitle>
        <FieldDescription className="text-foreground-muted">
          Shell commands run before the agent starts in each worktree session
        </FieldDescription>
        <Textarea
          rows={3}
          placeholder={'nvm use\nsource .envrc'}
          value={form.shellSetup}
          onChange={(e) => update('shellSetup', e.target.value)}
        />
      </Field>

      <Separator />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <FieldTitle>Lifecycle scripts</FieldTitle>
          <FieldDescription className="text-foreground-muted">
            Shell commands run at each stage of the worktree lifecycle. One command per line.
            <span> See </span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="group inline-flex h-auto cursor-pointer items-center gap-1 px-0 text-sm font-normal text-muted-foreground hover:text-foreground hover:no-underline focus-visible:outline-none focus-visible:ring-0"
              onClick={() => rpc.app.openExternal('https://www.emdash.sh/docs/project-config')}
            >
              <span className="font-mono text-xs transition-colors group-hover:text-foreground">
                docs
              </span>
              <span className="text-sm text-muted-foreground transition-colors group-hover:text-foreground">
                ↗
              </span>
            </Button>
            <span> for the full project config reference.</span>
          </FieldDescription>
        </div>

        <Field>
          <ShareableSettingTitle
            field="scripts.setup"
            overrideSources={getOverrideSources('scripts.setup')}
            onRestore={() => update('scriptSetup', '')}
          >
            Setup
          </ShareableSettingTitle>
          <Textarea
            rows={3}
            placeholder={'npm install\ncp .env.example .env'}
            value={form.scriptSetup}
            onChange={(e) => update('scriptSetup', e.target.value)}
          />
        </Field>

        <Field>
          <ShareableSettingTitle
            field="scripts.run"
            overrideSources={getOverrideSources('scripts.run')}
            onRestore={() => update('scriptRun', '')}
          >
            Run
          </ShareableSettingTitle>
          <Textarea
            rows={3}
            placeholder="npm run dev"
            value={form.scriptRun}
            onChange={(e) => update('scriptRun', e.target.value)}
          />
        </Field>

        <Field>
          <ShareableSettingTitle
            field="scripts.teardown"
            overrideSources={getOverrideSources('scripts.teardown')}
            onRestore={() => update('scriptTeardown', '')}
          >
            Teardown
          </ShareableSettingTitle>
          <Textarea
            rows={3}
            placeholder="docker compose down"
            value={form.scriptTeardown}
            onChange={(e) => update('scriptTeardown', e.target.value)}
          />
        </Field>
      </div>
    </>
  );
}
