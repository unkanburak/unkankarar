declare global {
  // eslint-disable-next-line no-var
  var __unkanDemoEvent: unknown;
  // eslint-disable-next-line no-var
  var __unkanCancellationNotice: unknown;
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

export {};
