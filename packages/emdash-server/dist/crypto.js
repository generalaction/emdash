import { createHmac, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
export function generateApiKey() {
    return `esk_${nanoid(32)}`;
}
export function generateWebhookToken() {
    return `wh_${nanoid(32)}`;
}
export function createHmacSignature(secret, payload) {
    return createHmac('sha256', secret).update(payload).digest('hex');
}
export function verifyGithubSignature(secret, payload, signature) {
    if (!signature)
        return false;
    const expected = `sha256=${createHmacSignature(secret, payload)}`;
    try {
        return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    }
    catch {
        return false;
    }
}
