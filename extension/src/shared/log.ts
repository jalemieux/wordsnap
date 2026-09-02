// Diagnostic logging. Always on, terse, prefixed, so a user can open DevTools and see what WordSnap did.
// Content script lines appear in the page console; background lines in the service worker console.
const PREFIX = '[wordsnap]';

export const log = {
  info(...args: unknown[]): void {
    console.info(PREFIX, ...args);
  },
  warn(...args: unknown[]): void {
    console.warn(PREFIX, ...args);
  },
  error(...args: unknown[]): void {
    console.error(PREFIX, ...args);
  },
};
