declare global {
  // eslint-disable-next-line no-var
  var __unkanDemoEvent: unknown;
  // eslint-disable-next-line no-var
  var __unkanCancellationNotice: unknown;
  var __unkanEventMeta: Record<string, { acknowledged: string[]; reactions: Record<string, string> }> | undefined;
}

export function getDemoEvent() {
  return globalThis.__unkanDemoEvent ?? null;
}

export function setDemoEvent(event: unknown) {
  globalThis.__unkanDemoEvent = event;
  return event;
}

export function getCancellationNotice() {
  return globalThis.__unkanCancellationNotice ?? null;
}

export function setCancellationNotice(notice: unknown) {
  globalThis.__unkanCancellationNotice = notice;
  return notice;
}

export function getDemoEventMeta(eventId: string) {
  globalThis.__unkanEventMeta ??= {};
  return globalThis.__unkanEventMeta[eventId] ?? { acknowledged: [], reactions: {} };
}

export function setDemoEventMeta(eventId: string, meta: { acknowledged: string[]; reactions: Record<string, string> }) {
  globalThis.__unkanEventMeta ??= {};
  globalThis.__unkanEventMeta[eventId] = meta;
  return meta;
}

export {};
