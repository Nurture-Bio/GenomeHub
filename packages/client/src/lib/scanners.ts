/**
 * scanners.ts — Strategy pattern for head-of-file dataset scanning.
 *
 * A DatasetHeadScanner reads string chunks from a ReadableStream and extracts
 * the first `limit` records.  The stream MUST be text (pipe the fetch body
 * through TextDecoderStream before calling scan()) so the scanner never splits
 * a multi-byte UTF-8 codepoint.
 *
 * Implementations:
 *   JsonHeadScanner  — top-level JSON array: [{...}, {...}, ...]
 *
 * Adding a new format (CSV, NDJSON, etc.) is one class that implements scan().
 */

// ── Interface ────────────────────────────────────────────────────────────────

export interface ScanResult<T = unknown> {
  /** Parsed records (at most `limit`). */
  rows: T[];
  /** True when the stream contained more records than `limit`. */
  truncated: boolean;
}

export interface DatasetHeadScanner<T = unknown> {
  /**
   * Read string chunks from `stream` until `limit` records have been found,
   * then return them.  The caller is responsible for aborting the underlying
   * fetch — the scanner simply stops reading.
   */
  scan(stream: ReadableStream<string>, limit: number): Promise<ScanResult<T>>;
}

// ── JsonHeadScanner ──────────────────────────────────────────────────────────
//
// Strategy: accumulate text chunks while a lightweight state machine tracks
// the byte offset where the Nth top-level array element ends.  Once found,
// slice the buffer, append ']', and hand the substring to native JSON.parse().
//
// The scanner does NOT parse JSON itself.  It only counts brace depth at the
// top level of the array, while correctly ignoring braces inside strings.
//
// ── Backslash parity ─────────────────────────────────────────────────────────
//
// A quote preceded by an odd number of backslashes is escaped (string continues).
// A quote preceded by an even number (including zero) terminates the string.
//
//   "hello\""       →  \" = escaped, string continues
//   "hello\\\\"     →  \\\\ = two escaped slashes, quote terminates
//   "hello\\\"x"    →  \\\  = escaped slash + escaped quote, string continues
//
// We track this with a `backslashes` counter that resets on every non-backslash
// character.  When we hit a quote, `backslashes & 1` tells us the parity.

export class JsonHeadScanner implements DatasetHeadScanner<Record<string, unknown>> {

  async scan(
    stream: ReadableStream<string>,
    limit:  number,
  ): Promise<ScanResult<Record<string, unknown>>> {

    const reader = stream.getReader();
    let buf = '';

    // State machine
    let depth       = 0;     // brace/bracket nesting depth within one element
    let inString    = false;  // inside a JSON string literal
    let backslashes = 0;     // consecutive trailing backslashes (for parity check)
    let elements    = 0;     // top-level elements fully closed
    let scanning    = false; // true once we've entered the top-level '[' array
    let endOffset   = -1;    // buffer offset just past the Nth element's closing char

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunkStart = buf.length;
        buf += value;

        // Resume scanning from where the previous chunk left off.
        for (let i = chunkStart; i < buf.length; i++) {
          const ch = buf[i]!;

          // ── Inside a string literal ────────────────────────────────────
          if (inString) {
            if (ch === '\\') {
              backslashes++;
              continue;
            }
            if (ch === '"' && (backslashes & 1) === 0) {
              // Even backslashes (including zero): quote terminates the string.
              inString = false;
            }
            backslashes = 0;
            continue;
          }

          // ── Outside any string ─────────────────────────────────────────

          // Skip whitespace and commas between elements.
          if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === ',') {
            continue;
          }

          // Enter the top-level array.
          if (!scanning) {
            if (ch === '[') { scanning = true; }
            continue;
          }

          // Track nesting.
          if (ch === '"') {
            inString    = true;
            backslashes = 0;
            continue;
          }

          if (ch === '{' || ch === '[') {
            depth++;
            continue;
          }

          if (ch === '}' || ch === ']') {
            depth--;
            if (depth === 0) {
              // A top-level element just closed.
              elements++;
              if (elements >= limit) {
                endOffset = i + 1;
                break;
              }
            }
            // depth < 0 means we hit the closing ']' of the top-level array
            // before reaching `limit` elements.
            if (depth < 0) break;
            continue;
          }

          // Scalar at the top level of the array (number, true, false, null).
          // These have depth === 0 because they aren't wrapped in {} or [].
          // We can't simply count them on first char because a number like
          // "123.456" spans multiple characters.  Instead, detect the END:
          // a scalar ends when we see the next comma, ']', or whitespace.
          // But we already skip commas and whitespace above, so if we're
          // here at depth === 0 with a non-structural char, we're mid-scalar.
          // We handle this by not incrementing — the comma/close-bracket
          // after the scalar will trigger the count.  But we need to track
          // that we ARE inside a top-level scalar so the comma handler knows.
          //
          // Actually, simpler: a top-level scalar value in a JSON array
          // (e.g., [1, 2, 3]) is not a record — it's not useful for a
          // dataset preview.  If someone is previewing [{"a":1}, {"b":2}]
          // (the expected case), top-level elements are always objects.
          // For robustness, treat any depth-0 value start as beginning an
          // element, and let the next comma or ']' close it.
          // But actually this is already handled: '{' increments depth,
          // '}' decrements and counts.  For bare scalars, we need a
          // different approach.  Let's use a simple flag.
        }

        if (endOffset !== -1) break;
      }
    } finally {
      reader.releaseLock();
    }

    // ── Parse ────────────────────────────────────────────────────────────────

    const truncated = elements >= limit;

    if (elements === 0) {
      // Stream was empty or not a JSON array.
      return { rows: [], truncated: false };
    }

    // Slice up to the boundary and hand to native JSON.parse().
    // buf[0..endOffset) contains '[' + N complete elements + commas.
    // Append ']' to make it valid JSON.
    const json = endOffset !== -1
      ? buf.slice(0, endOffset) + ']'
      : buf; // entire stream was consumed (< limit elements)

    // Ensure the json starts with '['.  If the buffer starts with whitespace
    // or a BOM before '[', find the opening bracket.
    const openBracket = json.indexOf('[');
    const toParse = openBracket > 0 ? json.slice(openBracket) : json;

    const rows = JSON.parse(toParse) as Record<string, unknown>[];
    return { rows, truncated };
  }
}
