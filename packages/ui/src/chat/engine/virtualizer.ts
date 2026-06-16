/**
 * Virtualizer — Fenwick-tree (BIT) based scroll virtualization.
 *
 * Maintains per-row pixel heights in a Binary Indexed Tree for O(log n)
 * prefix-sum updates and lookups over potentially 10k+ rows.
 *
 * API:
 *   setCount(n, estimate)  — resize, seeding new rows with estimate(i)
 *   setSize(i, h)          — update row height, returns pixel delta for scroll-anchor correction
 *   top(i)                 — pixel offset of row i from the top (prefix sum [0,i))
 *   total()                — total canvas height
 *   findIndex(offset)      — binary lift: row index at a given pixel offset
 *   range(scrollTop, viewH, overscan) — { start, end } of visible rows (inclusive)
 */

export class Virtualizer {
  private n = 0;
  /** Actual per-row sizes (truth). */
  private sizes: Float64Array = new Float64Array(0);
  /** Fenwick BIT: bit[i] = sum over a range ending at i (1-indexed). */
  private bit: Float64Array = new Float64Array(0);

  // ── Internal BIT operations ─────────────────────────────────────────────────

  private bitUpdate(i: number, delta: number): void {
    // 1-indexed BIT
    for (let j = i + 1; j <= this.n; j += j & -j) {
      this.bit[j] += delta;
    }
  }

  private bitQuery(i: number): number {
    // prefix sum [0, i] (0-indexed row i maps to 1-indexed i+1)
    let s = 0;
    for (let j = i + 1; j > 0; j -= j & -j) {
      s += this.bit[j];
    }
    return s;
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Resize to n rows. New rows are seeded with estimate(i); removed rows are dropped.
   * Existing measured rows keep their sizes.
   */
  setCount(n: number, estimate: (i: number) => number): void {
    const prevN = this.n;

    if (n > this.n) {
      // Grow: allocate new arrays and copy existing data
      const newSizes = new Float64Array(n);
      const newBit = new Float64Array(n + 1);
      newSizes.set(this.sizes.subarray(0, prevN));
      // Rebuild BIT from scratch (only needed when growing)
      this.n = n;
      this.sizes = newSizes;
      this.bit = newBit;

      // Rebuild BIT for all existing rows
      for (let i = 0; i < prevN; i++) {
        this.bitUpdate(i, this.sizes[i]);
      }
      // Seed new rows
      for (let i = prevN; i < n; i++) {
        const h = estimate(i);
        this.sizes[i] = h;
        this.bitUpdate(i, h);
      }
    } else if (n < this.n) {
      // Shrink: rebuild with fewer rows
      const newSizes = new Float64Array(n);
      const newBit = new Float64Array(n + 1);
      newSizes.set(this.sizes.subarray(0, n));
      this.n = n;
      this.sizes = newSizes;
      this.bit = newBit;
      for (let i = 0; i < n; i++) {
        this.bitUpdate(i, this.sizes[i]);
      }
    }
    // n === this.n: no-op
  }

  /**
   * Update the height of row i. Returns the signed pixel delta (newH - oldH),
   * which the engine uses for scroll-anchor correction when the row is above
   * the viewport.
   */
  setSize(i: number, h: number): number {
    if (i < 0 || i >= this.n) return 0;
    const old = this.sizes[i];
    const delta = h - old;
    if (delta === 0) return 0;
    this.sizes[i] = h;
    this.bitUpdate(i, delta);
    return delta;
  }

  /** Pixel offset of row i from the canvas top (sum of rows 0..i-1). */
  top(i: number): number {
    if (i <= 0) return 0;
    return this.bitQuery(i - 1);
  }

  /** Total canvas height (sum of all row heights). */
  total(): number {
    return this.n > 0 ? this.bitQuery(this.n - 1) : 0;
  }

  /** Size of row i. */
  size(i: number): number {
    return i >= 0 && i < this.n ? this.sizes[i] : 0;
  }

  /** Count of rows. */
  get count(): number {
    return this.n;
  }

  /**
   * Binary-lift search: find the row index whose top offset ≤ offset < top+height.
   * Returns 0 for empty or out-of-range.
   */
  findIndex(offset: number): number {
    if (this.n === 0 || offset <= 0) return 0;
    const total = this.total();
    if (offset >= total) return Math.max(0, this.n - 1);

    // Binary lift on the BIT: find smallest i s.t. bit prefix sum > offset
    let idx = 0;
    let bitMask = 1;
    while (bitMask <= this.n) bitMask <<= 1;
    bitMask >>= 1;

    let runningSum = 0;
    while (bitMask > 0) {
      const next = idx + bitMask;
      if (next <= this.n && runningSum + this.bit[next] <= offset) {
        runningSum += this.bit[next];
        idx = next;
      }
      bitMask >>= 1;
    }
    // idx is now the 1-based index of the last row whose cumulative sum ≤ offset
    // so the 0-based row containing offset is idx
    return Math.min(idx, this.n - 1);
  }

  /**
   * Returns inclusive { start, end } row indices visible at [scrollTop, scrollTop+viewH],
   * expanded by `overscan` rows on each side.
   */
  range(scrollTop: number, viewH: number, overscan = 4): { start: number; end: number } {
    if (this.n === 0) return { start: 0, end: -1 };
    const start = Math.max(0, this.findIndex(scrollTop) - overscan);
    const end = Math.min(this.n - 1, this.findIndex(scrollTop + viewH) + overscan);
    return { start, end };
  }
}
