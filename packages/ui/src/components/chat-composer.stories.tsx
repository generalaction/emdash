/**
 * ChatComposer — interactive playground.
 *
 * Toggle every composer state from the Storybook Controls panel, including
 * `showNotice`, to watch the notice band animate in and out above the input.
 * The "Dismiss" button (and the band's own ✕) hide the notice so the exit
 * transition can be observed; flip `showNotice` back on to replay the enter.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { ChatComposer } from './chat-composer';
import type {
  ComposerModelOption,
  ComposerNotice,
  ComposerNoticeVariant,
} from './chat-composer';
import { Button } from '../primitives/button';

// ── Mock model options ────────────────────────────────────────────────────────

const MOCK_MODELS: Record<string, ComposerModelOption> = {
  'claude-opus-4': {
    name: 'Claude Opus 4',
    description: 'Most capable model for complex reasoning and nuanced tasks.',
    modelFeatures: { contextWindowSize: 200_000, speed: 0.4, intelligence: 1 },
  },
  'claude-sonnet-4-5': {
    name: 'Claude Sonnet 4.5',
    description: 'Excellent balance of speed and intelligence for everyday tasks.',
    modelFeatures: { contextWindowSize: 200_000, speed: 0.75, intelligence: 0.85 },
  },
  'gpt-4o': {
    name: 'GPT-4o',
    description: 'OpenAI flagship multimodal model.',
    modelFeatures: { contextWindowSize: 128_000, speed: 0.7, intelligence: 0.9 },
  },
};

// ── Story args ────────────────────────────────────────────────────────────────

interface PlaygroundArgs {
  disabled: boolean;
  isWorking: boolean;
  canSubmit: boolean;
  showModelSelector: boolean;
  showAttachButton: boolean;
  showNotice: boolean;
  noticeVariant: ComposerNoticeVariant;
  noticeTitle: string;
  noticeMessage: string;
}

function ComposerPlayground(args: PlaygroundArgs) {
  const {
    disabled,
    isWorking,
    canSubmit,
    showModelSelector,
    showAttachButton,
    showNotice,
    noticeVariant,
    noticeTitle,
    noticeMessage,
  } = args;

  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-5');
  const [dismissed, setDismissed] = useState(false);

  // Re-arm the notice whenever the control is toggled back on so the enter
  // transition can be replayed after a manual dismiss.
  useEffect(() => {
    if (showNotice) setDismissed(false);
  }, [showNotice]);

  const noticeVisible = showNotice && !dismissed;
  const notice: ComposerNotice | null = noticeVisible
    ? {
        variant: noticeVariant,
        title: noticeTitle || undefined,
        message: noticeMessage,
        onDismiss: () => setDismissed(true),
      }
    : null;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-3 flex items-center gap-3">
        <Button
          size="sm"
          variant="ghost"
          tone="destructive"
          disabled={!noticeVisible}
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </Button>
        <span className="text-xs text-foreground-muted">
          Toggle <code>showNotice</code> in Controls to watch the band transition in and out.
        </span>
      </div>

      <ChatComposer
        disabled={disabled}
        isWorking={isWorking}
        canSubmit={canSubmit}
        modelOptions={showModelSelector ? MOCK_MODELS : null}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        onSubmit={() => {}}
        onStop={() => {}}
        onAttach={showAttachButton ? () => {} : undefined}
        notice={notice}
      />
    </div>
  );
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta: Meta<PlaygroundArgs> = {
  title: 'Components/ChatComposer',
  parameters: { layout: 'centered' },
  render: (args) => <ComposerPlayground {...args} />,
  argTypes: {
    disabled: { control: 'boolean', description: 'Session closed — blocks the editor and controls.' },
    isWorking: { control: 'boolean', description: 'Agent is responding — shows the Stop button.' },
    canSubmit: {
      control: 'boolean',
      description: 'Session ready — when false, Send/Enter is blocked but typing is allowed.',
    },
    showModelSelector: { control: 'boolean', description: 'Render the model selector in the toolbar.' },
    showAttachButton: { control: 'boolean', description: 'Render the attachment (paperclip) button.' },
    showNotice: { control: 'boolean', description: 'Show the session-state notice band above the input.' },
    noticeVariant: {
      control: 'inline-radio',
      options: ['error', 'warning', 'info'],
      description: 'Notice color/severity.',
    },
    noticeTitle: { control: 'text', description: 'Optional notice heading.' },
    noticeMessage: { control: 'text', description: 'Notice body copy.' },
  },
  args: {
    disabled: false,
    isWorking: false,
    canSubmit: true,
    showModelSelector: true,
    showAttachButton: true,
    showNotice: false,
    noticeVariant: 'error',
    noticeTitle: 'Turn limit reached',
    noticeMessage:
      'The agent hit the maximum number of turn requests. Send a new message to continue.',
  },
};

export default meta;

type Story = StoryObj<PlaygroundArgs>;

/** Full controls playground — flip any arg in the Controls panel. */
export const Playground: Story = {};
