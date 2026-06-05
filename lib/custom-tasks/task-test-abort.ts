/** Thrown when an admin test is cancelled (client Stop or request abort). */
export class TaskTestCancelledError extends Error {
  constructor(message = "Test stopped") {
    super(message);
    this.name = "TaskTestCancelledError";
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new TaskTestCancelledError();
  }
}

export function isTaskTestCancelledError(e: unknown): boolean {
  return e instanceof TaskTestCancelledError;
}
