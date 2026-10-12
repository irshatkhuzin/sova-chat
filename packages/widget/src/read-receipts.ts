/** Batch visible message IDs; retain failed acknowledgements until focus/reconnect. */
export class ReadReceiptQueue {
  private pending = new Set<string>();
  private confirmed = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private busy = false;
  constructor(private readonly canSend: () => boolean, private readonly send: (ids: string[]) => Promise<void>) {}
  add(ids: string[]): void {
    for (const id of ids) if (/^\d+$/.test(id) && !this.confirmed.has(id)) this.pending.add(id);
    this.wake();
  }
  wake(delay = 300): void {
    if (this.timer || this.busy || !this.pending.size || !this.canSend()) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, delay);
  }
  private async flush(): Promise<void> {
    if (!this.canSend() || this.busy) return;
    const generation = this.generation, ids = [...this.pending].slice(0, 100);
    this.busy = true;
    let retry = false;
    try {
      await this.send(ids);
      if (generation !== this.generation) return;
      for (const id of ids) { this.pending.delete(id); this.confirmed.add(id); }
    } catch { retry = true; }
    finally {
      if (generation === this.generation) { this.busy = false; this.wake(retry ? 5000 : 300); }
    }
  }
  reset(): void {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined; this.busy = false;
    this.pending.clear(); this.confirmed.clear();
  }
}
