export async function attemptAuxiliaryAfterCommit(
  task: () => Promise<unknown>,
  onFailure: (error: unknown) => void,
) {
  try {
    await task();
    return 'accepted' as const;
  } catch (error) {
    onFailure(error);
    return 'deferred' as const;
  }
}
