/** Share a small request budget across all regional page loaders. */
export function createRequestLimiter(limit = 4) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid concurrency limit');
  let active = 0;
  const queue: Array<() => void> = [];
  return async function run<T>(task: () => PromiseLike<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      const start = () => { active++; resolve(); };
      if (active < limit) start();
      else queue.push(start);
    });
    try {
      return await task();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
