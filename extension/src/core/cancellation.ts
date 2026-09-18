/** Tracks in-flight cancellable requests (currently only `search.text`) so a
 * timed-out `call()` can ask a long-running handler to stop early instead of
 * running to completion after nobody is listening for its result. */
export class Cancellation {
  private readonly flags = new Map<string, { cancelled: boolean }>();

  register(requestId: string): { cancelled: boolean } {
    const flag = { cancelled: false };
    this.flags.set(requestId, flag);
    return flag;
  }

  unregister(requestId: string): void {
    this.flags.delete(requestId);
  }

  cancel(requestId: string): boolean {
    const flag = this.flags.get(requestId);
    if (!flag) {
      return false;
    }
    flag.cancelled = true;
    return true;
  }
}
