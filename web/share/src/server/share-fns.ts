import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { env } from 'cloudflare:workers';
import type { ShareFetchResponse, ShareType } from '../../../../src/shared/share';
import { renderMarkdown, stripFrontmatter } from './highlight';
import { getShareRow, parseStoredShare } from './shares';

async function loadShare(type: ShareType, id: string): Promise<ShareFetchResponse> {
  const row = await getShareRow(env.DB, type, id);
  if (!row) throw notFound();

  const share = parseStoredShare(row);
  if (!share) throw notFound();
  return share;
}

function requestOrigin(): string {
  return new URL(getRequest().url).origin;
}

const idValidator = (input: { id: string }) => input;

export const getSkillSharePage = createServerFn()
  .inputValidator(idValidator)
  .handler(async ({ data }) => {
    const share = await loadShare('skill', data.id);
    if (share.payload.type !== 'skill') throw notFound();

    return {
      id: share.id,
      skill: share.payload.skill,
      contentHtml: await renderMarkdown(stripFrontmatter(share.payload.skill.skillMdContent)),
      origin: requestOrigin(),
    };
  });

export const getPromptSharePage = createServerFn()
  .inputValidator(idValidator)
  .handler(async ({ data }) => {
    const share = await loadShare('prompt', data.id);
    if (share.payload.type !== 'prompt') throw notFound();

    return {
      id: share.id,
      prompt: share.payload.prompt,
      origin: requestOrigin(),
    };
  });

export const getAutomationSharePage = createServerFn()
  .inputValidator(idValidator)
  .handler(async ({ data }) => {
    const share = await loadShare('automation', data.id);
    if (share.payload.type !== 'automation') throw notFound();

    return {
      id: share.id,
      automation: share.payload.automation,
      origin: requestOrigin(),
    };
  });
