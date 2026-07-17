import { isWireMessage, type WireMessage } from '../protocol';

type Bytes = Uint8Array<ArrayBufferLike>;

const FRAME_JSON = 0x00;
const FRAME_BINARY = 0x01;
const HEADER_BYTES = 5;
const BODY_LENGTH_BYTES = 4;

export const DEFAULT_MAX_WIRE_FRAME_BYTES = 16 * 1024 * 1024;

export type WireFrameDecoder = {
  push(chunk: Uint8Array): WireMessage[];
  reset(): void;
};

export function encodeWireFrame(
  message: WireMessage,
  maxFrameBytes = DEFAULT_MAX_WIRE_FRAME_BYTES
): Uint8Array<ArrayBuffer> {
  assertMaxFrameBytes(maxFrameBytes);

  if (message.kind === 'blob-chunk') {
    const header = encodeJson({
      kind: message.kind,
      channel: message.channel,
      seq: message.seq,
    });
    const body = message.data;
    const frameLength = HEADER_BYTES + header.byteLength + BODY_LENGTH_BYTES + body.byteLength;
    assertFrameLength(frameLength, maxFrameBytes);

    const frame = new Uint8Array(frameLength);
    frame[0] = FRAME_BINARY;
    writeU32(frame, 1, header.byteLength);
    frame.set(header, HEADER_BYTES);
    writeU32(frame, HEADER_BYTES + header.byteLength, body.byteLength);
    frame.set(body, HEADER_BYTES + header.byteLength + BODY_LENGTH_BYTES);
    return frame;
  }

  const header = encodeJson(message);
  const frameLength = HEADER_BYTES + header.byteLength;
  assertFrameLength(frameLength, maxFrameBytes);

  const frame = new Uint8Array(frameLength);
  frame[0] = FRAME_JSON;
  writeU32(frame, 1, header.byteLength);
  frame.set(header, HEADER_BYTES);
  return frame;
}

export function createWireFrameDecoder(options: { maxFrameBytes?: number } = {}): WireFrameDecoder {
  const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_WIRE_FRAME_BYTES;
  assertMaxFrameBytes(maxFrameBytes);
  let buffer: Bytes = new Uint8Array(0);

  return {
    push(chunk) {
      buffer = concat(buffer, chunk);
      const decoded = decodeFrames(buffer, maxFrameBytes);
      buffer = decoded.remaining;
      return decoded.messages;
    },
    reset() {
      buffer = new Uint8Array(0);
    },
  };
}

function decodeFrames(
  input: Bytes,
  maxFrameBytes: number
): { messages: WireMessage[]; remaining: Bytes } {
  const messages: WireMessage[] = [];
  let offset = 0;

  while (input.byteLength - offset >= HEADER_BYTES) {
    const kind = input[offset];
    const headerLength = readU32(input, offset + 1);
    const headerStart = offset + HEADER_BYTES;
    const headerEnd = headerStart + headerLength;

    assertFrameLength(headerEnd - offset, maxFrameBytes);
    if (input.byteLength < headerEnd) break;

    if (kind === FRAME_JSON) {
      appendParsedMessage(input.subarray(headerStart, headerEnd), undefined, messages);
      offset = headerEnd;
      continue;
    }

    if (kind !== FRAME_BINARY) throw new Error(`Unknown Wire frame kind '${String(kind)}'`);
    if (input.byteLength - headerEnd < BODY_LENGTH_BYTES) break;

    const bodyLength = readU32(input, headerEnd);
    const bodyStart = headerEnd + BODY_LENGTH_BYTES;
    const bodyEnd = bodyStart + bodyLength;
    assertFrameLength(bodyEnd - offset, maxFrameBytes);
    if (input.byteLength < bodyEnd) break;

    appendParsedMessage(
      input.subarray(headerStart, headerEnd),
      input.subarray(bodyStart, bodyEnd),
      messages
    );
    offset = bodyEnd;
  }

  return { messages, remaining: input.subarray(offset) };
}

function appendParsedMessage(
  headerBytes: Uint8Array,
  body: Bytes | undefined,
  messages: WireMessage[]
): void {
  const parsed: unknown = JSON.parse(decodeText(headerBytes));
  const message = body
    ? { ...(parsed as Record<string, unknown>), data: new Uint8Array(body) }
    : parsed;
  if (isWireMessage(message)) messages.push(message);
}

function encodeJson(value: unknown): Uint8Array {
  return encodeText(JSON.stringify(value));
}

function concat(left: Bytes, right: Uint8Array): Bytes {
  if (left.byteLength === 0) return new Uint8Array(right);
  if (right.byteLength === 0) return left;
  const out = new Uint8Array(left.byteLength + right.byteLength);
  out.set(left, 0);
  out.set(right, left.byteLength);
  return out;
}

function encodeText(value: string): Uint8Array {
  return new globalThis.TextEncoder().encode(value);
}

function decodeText(value: Uint8Array): string {
  return new globalThis.TextDecoder().decode(value);
}

function assertMaxFrameBytes(value: number): void {
  if (!Number.isSafeInteger(value) || value < HEADER_BYTES || value > 0xffffffff) {
    throw new RangeError('maxFrameBytes must be an integer between 5 and 4294967295');
  }
}

function assertFrameLength(value: number, maxFrameBytes: number): void {
  if (!Number.isSafeInteger(value) || value > maxFrameBytes) {
    throw new Error(`Wire frame exceeds ${String(maxFrameBytes)} bytes`);
  }
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function readU32(source: Uint8Array, offset: number): number {
  return (
    source[offset]! * 0x1000000 +
    ((source[offset + 1]! << 16) | (source[offset + 2]! << 8) | source[offset + 3]!)
  );
}
