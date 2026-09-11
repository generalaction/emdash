const FOCUS_REPLY = /^\x1b\[[IO]$/;
const DEVICE_ATTRIBUTES_REPLY = /^\x1b\[(?:\?|>)?[\d;]*c$/;
const XTVERSION_REPLY = /^\x1bP>\|[\s\S]*?\x1b\\$/;

export function isXtermCapabilityReply(data: string): boolean {
  return (
    FOCUS_REPLY.test(data) || DEVICE_ATTRIBUTES_REPLY.test(data) || XTVERSION_REPLY.test(data)
  );
}
