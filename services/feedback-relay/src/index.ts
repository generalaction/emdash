export interface Env {
  SLACK_BOT_TOKEN: string;
  SLACK_CHANNEL_ID: string;
  // When set, requests must carry a matching x-emdash-feedback-secret header.
  RELAY_SHARED_SECRET?: string;
}

const SECRET_HEADER = 'x-emdash-feedback-secret';
const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'method_not_allowed' }, 405);
    }

    if (env.RELAY_SHARED_SECRET) {
      const provided = request.headers.get(SECRET_HEADER) ?? '';
      const enc = new TextEncoder();
      const a = enc.encode(provided);
      const b = enc.encode(env.RELAY_SHARED_SECRET);
      const equal =
        a.byteLength === b.byteLength &&
        crypto.subtle.timingSafeEqual(a, b);
      if (!equal) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ ok: false, error: 'invalid_form' }, 400);
    }

    const content = String(form.get('content') ?? '').trim();
    const files: File[] = [];
    for (const [key, value] of form.entries()) {
      if (key === 'content') continue;
      if (value instanceof File) files.push(value);
    }

    if (!content && files.length === 0) {
      return json({ ok: false, error: 'empty_feedback' }, 400);
    }
    if (files.length > MAX_FILES) {
      return json({ ok: false, error: 'too_many_files' }, 413);
    }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      return json({ ok: false, error: 'payload_too_large' }, 413);
    }

    try {
      if (files.length === 0) {
        await postMessage(env, content);
      } else {
        await uploadFilesWithMessage(env, content, files);
      }
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : 'relay_failed' }, 502);
    }

    return json({ ok: true });
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function slack(env: Env, method: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!data.ok) {
    throw new Error(`slack ${method} failed: ${String(data.error ?? response.status)}`);
  }
  return data;
}

async function postMessage(env: Env, text: string): Promise<void> {
  await slack(env, 'chat.postMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel: env.SLACK_CHANNEL_ID, text }),
  });
}

// Slack's external upload flow (the old files.upload is retired): per file, get
// an upload URL, POST the bytes, then complete — with the text as initial_comment.
async function uploadFilesWithMessage(env: Env, text: string, files: File[]): Promise<void> {
  const uploaded: { id: string; title: string }[] = [];

  for (const file of files) {
    const name = file.name || 'attachment';
    const params = new URLSearchParams({ filename: name, length: String(file.size) });
    const urlData = await slack(env, 'files.getUploadURLExternal', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const uploadUrl = String(urlData.upload_url);
    const fileId = String(urlData.file_id);
    const uploadResponse = await fetch(uploadUrl, { method: 'POST', body: file });
    if (!uploadResponse.ok) {
      throw new Error(`file upload failed: ${uploadResponse.status}`);
    }

    uploaded.push({ id: fileId, title: name });
  }

  await slack(env, 'files.completeUploadExternal', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      files: uploaded,
      channel_id: env.SLACK_CHANNEL_ID,
      initial_comment: text || undefined,
    }),
  });
}
