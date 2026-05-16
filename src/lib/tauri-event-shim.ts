export async function listen<T>(
  _event: string,
  _handler: (event: { payload: T }) => void
): Promise<() => void> {
  return () => {};
}

export async function emit(_event: string, _payload?: unknown): Promise<void> {}
