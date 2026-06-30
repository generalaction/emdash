import type { Meta, StoryObj } from '@storybook/react-vite';
import { cx } from '@styles/utilities/cx';
import { useEffect, useState } from 'react';
import { Box } from '@/react/primitives/box';
import { Button } from '@/react/primitives/button';
import { ChatComposer } from '.';
import type {
  ComposerAgentOption,
  ComposerModelOption,
  ComposerNotice,
  ComposerNoticeVariant,
} from '.';
import * as s from '@react/story-layout.css';
import { sx } from '@styles/utilities/sprinkles.css';

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

function AgentDot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 16,
        height: 16,
        borderRadius: 4,
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

const MOCK_AGENTS: ComposerAgentOption[] = [
  {
    id: 'claude',
    name: 'Claude',
    icon: <AgentDot color="#d97706" />,
    description: 'Anthropic Claude coding agent.',
    groupLabel: 'Installed',
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    icon: <AgentDot color="#10b981" />,
    description: 'OpenAI Codex CLI agent.',
    groupLabel: 'Installed',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    icon: <AgentDot color="#6366f1" />,
    description: 'Google Gemini CLI agent.',
    disabled: true,
    groupLabel: 'Not installed',
  },
];

interface PlaygroundArgs {
  disabled: boolean;
  isWorking: boolean;
  canSubmit: boolean;
  showAgentSelector: boolean;
  agentLocked: boolean;
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
    showAgentSelector,
    agentLocked,
    showModelSelector,
    showAttachButton,
    showNotice,
    noticeVariant,
    noticeTitle,
    noticeMessage,
  } = args;

  const [selectedAgent, setSelectedAgent] = useState('claude');
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-5');
  const [dismissed, setDismissed] = useState(false);

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
    <Box className={cx(s.mxAuto, s.maxW2xl)} width="full">
      <Box marginBottom="3" display="flex" alignItems="center" gap="3">
        <Button
          size="sm"
          variant="ghost"
          tone="destructive"
          disabled={!noticeVisible}
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </Button>
        <span className={cx(sx({ fontSize: 'xs', color: 'foregroundMuted' }))}>
          Toggle <code>showNotice</code> in Controls to watch the band transition in and out.
        </span>
      </Box>

      <ChatComposer
        disabled={disabled}
        isWorking={isWorking}
        canSubmit={canSubmit}
        agentOptions={showAgentSelector ? MOCK_AGENTS : null}
        selectedAgent={selectedAgent}
        onAgentChange={setSelectedAgent}
        agentLocked={agentLocked}
        modelOptions={showModelSelector ? MOCK_MODELS : null}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        onSubmit={() => {}}
        onStop={() => {}}
        onAttach={showAttachButton ? () => {} : undefined}
        notice={notice}
      />
    </Box>
  );
}

const meta: Meta<PlaygroundArgs> = {
  title: 'Components/ChatComposer',
  parameters: { layout: 'centered' },
  render: (args) => <ComposerPlayground {...args} />,
  argTypes: {
    disabled: {
      control: 'boolean',
      description: 'Session closed — blocks the editor and controls.',
    },
    isWorking: { control: 'boolean', description: 'Agent is responding — shows the Stop button.' },
    canSubmit: {
      control: 'boolean',
      description: 'Session ready — when false, Send/Enter is blocked but typing is allowed.',
    },
    showAgentSelector: {
      control: 'boolean',
      description: 'Render the agent selector in the toolbar.',
    },
    agentLocked: {
      control: 'boolean',
      description: 'When true (prompt has been sent), the agent button is disabled.',
    },
    showModelSelector: {
      control: 'boolean',
      description: 'Render the model selector in the toolbar.',
    },
    showAttachButton: {
      control: 'boolean',
      description: 'Render the attachment (paperclip) button.',
    },
    showNotice: {
      control: 'boolean',
      description: 'Show the session-state notice band above the input.',
    },
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
    showAgentSelector: true,
    agentLocked: false,
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
