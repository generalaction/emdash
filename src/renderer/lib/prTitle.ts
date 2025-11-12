// Generate a concise PR title using Claude Code based on current git status

// Try Claude first; if unavailable, fall back to Codex
export async function generatePrTitleWithClaude(workspaceId: string): Promise<string | null> {
  try {
    // Pick provider: prefer Claude, then Codex
    let provider: 'claude' | 'codex' | null = null;
    const claude = await (window as any).electronAPI.agentCheckInstallation?.('claude');
    if (claude?.success && claude?.isInstalled) {
      provider = 'claude';
    } else {
      const codex = await (window as any).electronAPI.agentCheckInstallation?.('codex');
      if (codex?.success && codex?.isInstalled) provider = 'codex';
    }
    if (!provider) return null;

    // Gather changes summary from git status
    const status = await (window as any).electronAPI.getGitStatus(workspaceId);
    if (!status?.success || !Array.isArray(status?.changes) || status.changes.length === 0)
      return null;

    const files = status.changes as Array<{
      path: string;
      status: string;
      additions: number;
      deletions: number;
    }>;

    // Build a compact summary. Limit to first 20 files to avoid very long prompts.
    const lines: string[] = [];
    for (const c of files.slice(0, 20)) {
      const tag = c.status || 'modified';
      lines.push(`- ${tag} ${c.path} (+${c.additions} -${c.deletions})`);
    }
    const moreCount = files.length - 20;
    if (moreCount > 0) lines.push(`- …and ${moreCount} more files`);

    // Ensure a conversation exists (reuse the default one used by chat)
    const convo = await (window as any).electronAPI.getOrCreateDefaultConversation?.(workspaceId);
    if (!convo?.success || !convo?.conversation?.id) return null;

    const prompt = [
      'You are helping write a clear, concise pull request title.',
      'Given the changed files, output ONLY a short, imperative PR title (max 12 words).',
      'No trailing period. No backticks or quotes. No issue numbers. English.',
      '',
      'Changed files:',
      ...lines,
    ].join('\n');

    // Stream a one-shot message and collect the output
    const buffer: { text: string } = { text: '' };

    const offOut = (window as any).electronAPI.onAgentStreamOutput?.((data: any) => {
      if (data?.providerId !== provider) return;
      if (data?.workspaceId !== workspaceId) return;
      const chunk = typeof data.output === 'string' ? data.output : '';
      if (chunk) buffer.text += chunk;
    });
    const offErr = (window as any).electronAPI.onAgentStreamError?.((_data: any) => {});

    const done = new Promise<string>((resolve) => {
      const offDone = (window as any).electronAPI.onAgentStreamComplete?.((data: any) => {
        if (data?.providerId !== provider) return;
        if (data?.workspaceId !== workspaceId) return;
        offOut?.();
        offErr?.();
        offDone?.();
        resolve(buffer.text || '');
      });
      setTimeout(() => {
        try {
          offOut?.();
          offErr?.();
          offDone?.();
        } catch {}
        resolve(buffer.text || '');
      }, 20000);
    });

    await (window as any).electronAPI.agentSendMessageStream?.({
      providerId: provider,
      workspaceId,
      worktreePath: workspaceId,
      message: prompt,
      conversationId: convo.conversation.id,
    });

    const raw = (await done).trim();
    if (!raw) return null;

    const firstLine =
      raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => !!l) || '';
    if (!firstLine) return null;
    const cleaned = firstLine
      .replace(/^\s*#+\s*/, '')
      .replace(/^['"`]+|['"`]+$/g, '')
      .replace(/\s*\.$/, '')
      .slice(0, 120)
      .trim();

    return cleaned || null;
  } catch {
    return null;
  }
}
