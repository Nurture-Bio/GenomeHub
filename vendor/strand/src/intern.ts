/**
 * StrandInternTable — bidirectional string ↔ u32 handle mapping for utf8_ref fields.
 *
 * All utf8_ref fields in a Strand buffer share one handle space. A handle is a
 * u32 index into this table; the string at that index is the field's value.
 *
 * ## Footgun: missing handles at stream time
 *
 * A common pattern is to build the intern table during a Phase 1 stats scan
 * (first N records), then use the resulting handle map during Phase 2 streaming
 * (all records). If a value appears only in records outside the scan window —
 * including the empty string when a field is absent — Phase 2 throws
 * "Missing intern handle for value: ''".
 *
 * `StrandInternTable` prevents this in two ways:
 *
 * 1. `""` is **always handle 0**. Null, undefined, and missing field values
 *    in the stream are mapped to `""` rather than throwing.
 *
 * 2. `getHandle(value)` returns `0` for any value not seen during the scan
 *    instead of throwing. The caller can decide whether to skip the record or
 *    accept the fallback.
 *
 * ## Usage
 *
 * ```typescript
 * // Phase 1 — build from scan window
 * const table = new StrandInternTable();
 * for (const record of scanWindow) {
 *   table.intern(record.chrom);
 *   table.intern(record.strand);
 * }
 *
 * // Pass to SAB header and Phase 2 worker
 * const internArray = table.toArray();   // string[], handle N = internArray[N]
 *
 * // Phase 2 — resolve handles without throwing
 * const chromHandle = table.getHandle(record.chrom ?? ''); // 0 if unseen
 * ```
 */
export class StrandInternTable {
  private readonly _table: string[]          = [''];   // handle 0 = ""
  private readonly _index: Map<string, number> = new Map([['', 0]]);

  /**
   * Intern a string value. Returns its handle (existing or newly assigned).
   * The empty string always returns 0.
   */
  intern(value: string): number {
    const existing = this._index.get(value);
    if (existing !== undefined) return existing;
    const handle = this._table.length;
    this._table.push(value);
    this._index.set(value, handle);
    return handle;
  }

  /**
   * Look up the handle for a string value.
   *
   * Returns `0` (the empty-string handle) for any value not present in the
   * table — including values that only appear in records outside the inference
   * window. Never throws.
   */
  getHandle(value: string): number {
    return this._index.get(value) ?? 0;
  }

  /**
   * The number of distinct interned values (including the seeded `""`).
   */
  get size(): number {
    return this._table.length;
  }

  /**
   * Return the interned string at `handle`, or `undefined` for out-of-range handles.
   */
  getValue(handle: number): string | undefined {
    return this._table[handle];
  }

  /**
   * Export the table as a plain `string[]` for embedding in messages or SAB
   * headers. `table[N]` is the string for handle `N`.
   */
  toArray(): string[] {
    return this._table.slice();
  }

  /**
   * Reconstruct a `StrandInternTable` from a previously exported array (e.g.
   * received from a worker or decoded from a SAB header). The input array must
   * have `""` at index 0; throws if it does not.
   */
  static fromArray(arr: readonly string[]): StrandInternTable {
    if (arr[0] !== '') {
      throw new Error(
        `StrandInternTable.fromArray: arr[0] must be "" (empty string); got "${arr[0]}". ` +
        `Intern tables built by StrandInternTable always seed "" at handle 0.`,
      );
    }
    const t = new StrandInternTable();
    for (let i = 1; i < arr.length; i++) {
      t.intern(arr[i]!);
    }
    return t;
  }
}
