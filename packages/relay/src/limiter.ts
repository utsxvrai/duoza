/** Fixed-window counter per key. Enough to make guessing a 6-char code impractical. */
export class FixedWindowLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records a hit and returns whether it is allowed. */
  hit(key: string, now: number): boolean {
    const entry = this.hits.get(key)
    if (entry === undefined || now - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { windowStart: now, count: 1 })
      return true
    }
    entry.count++
    return entry.count <= this.limit
  }

  sweep(now: number): void {
    for (const [key, entry] of this.hits) {
      if (now - entry.windowStart >= this.windowMs) this.hits.delete(key)
    }
  }
}
