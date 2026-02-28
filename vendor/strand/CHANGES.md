# @strand/core — Change Log

## Unreleased

### Breaking: `initStrandHeader` no longer accepts a `meta` argument

**Before**
```ts
initStrandHeader(sab, map, { internTable: myStrings });
```

**After**
```ts
initStrandHeader(sab, map);
```

**What was removed**

The optional third argument to `initStrandHeader` accepted an arbitrary
plain object that was JSON-serialised and stored in the 4 KB header tail
alongside the auto-injected `columns` array.  `StrandMap.meta` exposed the
same data back out of `readStrandHeader`.

**Why it was a footgun**

The metadata region is bounded by the fixed 4 KB header.  After the schema
bytes are written, the remaining budget is roughly 4 KB minus ~92 bytes of
geometry fields minus the schema encoding (~4 bytes per field).  For a
schema with 10 fields that leaves ≈ 3.9 KB for metadata JSON.

The intended use case — storing a small intern table for self-describing
buffers — blows this budget the moment a real dataset is loaded.  A file
with several categorical columns and thousands of distinct values produces
an intern table of tens of kilobytes.  The call to `initStrandHeader`
throws `StrandHeaderError: Producer metadata (N bytes JSON) does not fit in
the header tail`, and because this happens synchronously inside an
`onmessage` handler that has no enclosing `try/catch`, the UI silently
hangs forever — the status never advances past the loading state and there
is no visible error.

The metadata argument looks harmless at the call site but creates a
data-size landmine: it works on small files and fails invisibly on large
ones.

**What to do instead**

The intern table (or any other side-channel data) belongs in ordinary JS
memory, not in the SAB header.  Pass it explicitly wherever it is needed:

```ts
// Allocate
const sab   = new SharedArrayBuffer(map.total_bytes);
initStrandHeader(sab, map);                       // no meta
const view  = new StrandView(sab, internTable);   // table passed directly
worker.postMessage({ sab, internTable });          // forwarded to worker
```

`columns` is still written automatically by `initStrandHeader` and read
back by `readStrandHeader` to reconstruct named `FieldDescriptor`s.  That
path is unchanged and requires no action.

**`StrandMap.meta` removed**

The `readonly meta?: unknown` field has been removed from the `StrandMap`
interface.  Any code that read `map.meta` after `readStrandHeader` must be
updated to carry that data through a separate channel.
