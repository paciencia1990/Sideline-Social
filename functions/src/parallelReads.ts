export async function mapConcurrentReads<Input, Output>(items: Input[], concurrency: number, read: (item: Input) => Promise<Output>): Promise<Output[]> {
  const results: Output[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const workers = await Promise.allSettled(Array.from({ length: Math.min(Math.max(1, Math.floor(concurrency)), items.length) }, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { results[index] = await read(items[index]); }
      catch (error) { failed = true; throw error; }
    }
  }));
  const failure = workers.find((worker): worker is PromiseRejectedResult => worker.status === 'rejected');
  if (failure) throw failure.reason;
  return results;
}
