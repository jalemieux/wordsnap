/**
 * Runs async tasks one after another in submission order. A rejected task is reported and does not block the next.
 * Port messages arrive in order but their handlers await storage reads, so without this a `session/snapshot` could
 * be handled before the `session/open` sent just ahead of it.
 */
export function serialQueue(onError: (err: unknown) => void = () => {}): (task: () => Promise<void>) => void {
  let tail: Promise<void> = Promise.resolve();
  return (task) => {
    tail = tail.then(task).catch(onError);
  };
}
