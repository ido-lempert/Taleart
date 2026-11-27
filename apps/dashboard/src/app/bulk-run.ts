/**
 * Runs `run` for each item, `limit` at a time, and sorts the outcomes: `run` resolves to '' when
 * the item is done, or to the message to show for the item that failed (as the store's actions do).
 * A throw counts as a failure. `onProgress` is called with how many items have finished so far, in
 * any order, so a dialog can say "Archiving 2 of 5". Both lists keep the items' order.
 *
 * Used with `createSelection` for the bulk actions of a list: one item's request per call of
 * `run`, the single-item endpoint, so no bulk endpoint is needed.
 */
export interface BulkOutcome<T> {
  succeeded: T[];
  failed: { item: T; message: string }[];
}

export async function runLimited<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<string>,
  onProgress?: (done: number) => void,
): Promise<BulkOutcome<T>> {
  const messages: string[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      let message: string;
      try {
        message = await run(items[index]);
      } catch {
        message = 'The request failed. Try again.';
      }
      messages[index] = message;
      done++;
      onProgress?.(done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker));
  return {
    succeeded: items.filter((_, index) => !messages[index]),
    failed: items.flatMap((item, index) => (messages[index] ? [{ item, message: messages[index] }] : [])),
  };
}
