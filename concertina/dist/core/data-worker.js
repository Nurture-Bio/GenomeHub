// src/core/types.ts
var asRowIndex = (n) => n;
var asPixelSize = (n) => n;
var asMs = (n) => n;
var asBatchSeq = (n) => n;
var BATCH_MAGIC = 2887631070;
var CELL_H_PADDING = 16;
var TYPE_TAG = {
  f64: 0,
  i32: 1,
  u32: 2,
  bool: 3,
  timestamp_ms: 4,
  utf8: 5,
  list_utf8: 6
};
var TAG_TO_TYPE = {
  0: "f64",
  1: "i32",
  2: "u32",
  3: "bool",
  4: "timestamp_ms",
  5: "utf8",
  6: "list_utf8"
};
var INITIAL_STORE_STATE = {
  status: "idle",
  layout: null,
  window: null,
  backpressure: { strategy: "NOMINAL", queueDepth: 0, avgRenderMs: asMs(0) },
  totalRows: 0,
  error: null
};

// src/core/data-worker.ts
var RingBuffer = class {
  constructor(capacity) {
    this.capacity = capacity;
    this.head = 0;
    this.count = 0;
    this.data = new Float64Array(capacity);
  }
  push(value) {
    this.data[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }
  mean() {
    if (this.count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.count; i++) sum += this.data[i];
    return sum / this.count;
  }
  get length() {
    return this.count;
  }
};
var NumericColumn = class {
  constructor(colType, initialCapacity = 8192) {
    this.colType = colType;
    this.length = 0;
    this.buf = this.alloc(initialCapacity);
  }
  alloc(n) {
    switch (this.colType) {
      case "f64":
      case "timestamp_ms":
        return new Float64Array(n);
      case "i32":
        return new Int32Array(n);
      case "u32":
        return new Uint32Array(n);
      case "bool":
        return new Uint8Array(n);
    }
  }
  append(src) {
    const needed = this.length + src.length;
    if (needed > this.buf.length) {
      const next = this.alloc(Math.max(this.buf.length * 2, needed));
      next.set(this.buf.subarray(0, this.length));
      this.buf = next;
    }
    this.buf.set(src, this.length);
    this.length += src.length;
  }
  /** Returns a copy of rows [startRow, startRow+count) as ArrayBuffer. */
  copySlice(startRow, count) {
    const end = Math.min(startRow + count, this.length);
    const actual = Math.max(0, end - startRow);
    return this.buf.slice(startRow, startRow + actual).buffer;
  }
  get rowCount() {
    return this.length;
  }
};
var Utf8Column = class {
  constructor(rowCapacity = 8192, bytesCapacity = 131072) {
    this.offsetLen = 1;
    this.bytesLen = 0;
    this.offsets = new Uint32Array(rowCapacity + 1);
    this.bytes = new Uint8Array(bytesCapacity);
    this.offsets[0] = 0;
  }
  append(srcOffsets, srcBytes, rowCount) {
    const addedBytes = srcOffsets[rowCount];
    const baseAbsolute = this.offsets[this.offsetLen - 1];
    if (this.offsetLen + rowCount > this.offsets.length) {
      const next = new Uint32Array(Math.max(this.offsets.length * 2, this.offsetLen + rowCount + 1));
      next.set(this.offsets.subarray(0, this.offsetLen));
      this.offsets = next;
    }
    if (this.bytesLen + addedBytes > this.bytes.length) {
      const next = new Uint8Array(Math.max(this.bytes.length * 2, this.bytesLen + addedBytes));
      next.set(this.bytes.subarray(0, this.bytesLen));
      this.bytes = next;
    }
    this.bytes.set(srcBytes.subarray(0, addedBytes), this.bytesLen);
    this.bytesLen += addedBytes;
    for (let i = 0; i < rowCount; i++) {
      this.offsets[this.offsetLen + i] = baseAbsolute + srcOffsets[i + 1];
    }
    this.offsetLen += rowCount;
  }
  /** Returns { offsets: ArrayBuffer, bytes: ArrayBuffer } for rows [startRow, startRow+count). */
  copySlice(startRow, count) {
    const end = Math.min(startRow + count, this.rowCount);
    const actual = Math.max(0, end - startRow);
    const base = this.offsets[startRow];
    const limit = this.offsets[startRow + actual];
    const byteLen = limit - base;
    const newOffsets = new Uint32Array(actual + 1);
    for (let i = 0; i <= actual; i++) {
      newOffsets[i] = this.offsets[startRow + i] - base;
    }
    const newBytes = this.bytes.slice(base, base + byteLen);
    return {
      offsets: newOffsets.buffer,
      bytes: newBytes.buffer
    };
  }
  get rowCount() {
    return this.offsetLen - 1;
  }
};
var ListUtf8Column = class {
  constructor(rowCapacity = 8192, itemCapacity = 65536, bytesCapacity = 524288) {
    this.rowOffLen = 1;
    this.itemOffLen = 1;
    this.bytesLen = 0;
    this.rowOffsets = new Uint32Array(rowCapacity + 1);
    this.itemOffsets = new Uint32Array(itemCapacity + 1);
    this.bytes = new Uint8Array(bytesCapacity);
    this.rowOffsets[0] = 0;
    this.itemOffsets[0] = 0;
  }
  append(totalItems, srcRowOff, srcItemOff, srcBytes, rowCount) {
    const baseItemIdx = this.itemOffLen - 1;
    const baseBytesLen = this.bytesLen;
    const addedBytes = totalItems > 0 ? srcItemOff[totalItems] : 0;
    if (this.rowOffLen + rowCount > this.rowOffsets.length) {
      const next = new Uint32Array(Math.max(this.rowOffsets.length * 2, this.rowOffLen + rowCount + 1));
      next.set(this.rowOffsets.subarray(0, this.rowOffLen));
      this.rowOffsets = next;
    }
    if (this.itemOffLen + totalItems > this.itemOffsets.length) {
      const next = new Uint32Array(Math.max(this.itemOffsets.length * 2, this.itemOffLen + totalItems + 1));
      next.set(this.itemOffsets.subarray(0, this.itemOffLen));
      this.itemOffsets = next;
    }
    if (baseBytesLen + addedBytes > this.bytes.length) {
      const next = new Uint8Array(Math.max(this.bytes.length * 2, baseBytesLen + addedBytes));
      next.set(this.bytes.subarray(0, baseBytesLen));
      this.bytes = next;
    }
    this.bytes.set(srcBytes.subarray(0, addedBytes), baseBytesLen);
    this.bytesLen += addedBytes;
    for (let j = 0; j < totalItems; j++) {
      this.itemOffsets[this.itemOffLen + j] = baseBytesLen + srcItemOff[j + 1];
    }
    this.itemOffLen += totalItems;
    for (let r = 0; r < rowCount; r++) {
      this.rowOffsets[this.rowOffLen + r] = baseItemIdx + srcRowOff[r + 1];
    }
    this.rowOffLen += rowCount;
  }
  /** Returns the wire-format sub-buffers for rows [startRow, startRow+count). */
  copySlice(startRow, count) {
    const end = Math.min(startRow + count, this.rowCount);
    const actual = Math.max(0, end - startRow);
    const baseItemIdx = this.rowOffsets[startRow];
    const endItemIdx = this.rowOffsets[startRow + actual];
    const sliceItems = endItemIdx - baseItemIdx;
    const baseByteIdx = sliceItems > 0 ? this.itemOffsets[baseItemIdx] : 0;
    const endByteIdx = sliceItems > 0 ? this.itemOffsets[endItemIdx] : 0;
    const header = new Uint32Array([sliceItems]);
    const newRowOffsets = new Uint32Array(actual + 1);
    const newItemOffsets = new Uint32Array(sliceItems + 1);
    const newBytes = this.bytes.slice(baseByteIdx, endByteIdx);
    for (let r = 0; r <= actual; r++) {
      newRowOffsets[r] = this.rowOffsets[startRow + r] - baseItemIdx;
    }
    for (let j = 0; j <= sliceItems; j++) {
      newItemOffsets[j] = this.itemOffsets[baseItemIdx + j] - baseByteIdx;
    }
    return {
      totalItems: header.buffer,
      rowOffsets: newRowOffsets.buffer,
      itemOffsets: newItemOffsets.buffer,
      bytes: newBytes.buffer
    };
  }
  get rowCount() {
    return this.rowOffLen - 1;
  }
};
function parseBatch(buffer) {
  const view = new DataView(buffer);
  let cursor = 0;
  const magic = view.getUint32(cursor, true);
  cursor += 4;
  if (magic !== BATCH_MAGIC) {
    throw new Error(`Invalid batch magic: 0x${magic.toString(16)}; expected 0x${BATCH_MAGIC.toString(16)}`);
  }
  const seq = view.getUint32(cursor, true);
  cursor += 4;
  const rowCount = view.getUint32(cursor, true);
  cursor += 4;
  const colCount = view.getUint32(cursor, true);
  cursor += 4;
  const descriptors = [];
  for (let i = 0; i < colCount; i++) {
    const typeTag = view.getUint32(cursor, true);
    cursor += 4;
    const byteLen = view.getUint32(cursor, true);
    cursor += 4;
    const type = TAG_TO_TYPE[typeTag];
    if (type === void 0) throw new Error(`Unknown type tag: ${typeTag}`);
    descriptors.push({ type, byteLen });
  }
  const columns = [];
  for (const { type, byteLen } of descriptors) {
    const slice = buffer.slice(cursor, cursor + byteLen);
    cursor += byteLen;
    if (type === "utf8") {
      const offsetByteLen = (rowCount + 1) * 4;
      const utf8Offsets = new Uint32Array(slice.slice(0, offsetByteLen));
      const utf8Bytes = new Uint8Array(slice.slice(offsetByteLen));
      columns.push({ type, data: null, utf8Offsets, utf8Bytes });
    } else if (type === "list_utf8") {
      let off = 0;
      const listTotalItems = new DataView(slice).getUint32(0, true);
      off += 4;
      const listRowOffsets = new Uint32Array(slice.slice(off, off + (rowCount + 1) * 4));
      off += (rowCount + 1) * 4;
      const listItemOffsets = new Uint32Array(slice.slice(off, off + (listTotalItems + 1) * 4));
      off += (listTotalItems + 1) * 4;
      const listBytes = new Uint8Array(slice.slice(off));
      columns.push({ type, data: null, listTotalItems, listRowOffsets, listItemOffsets, listBytes });
    } else {
      let data;
      switch (type) {
        case "f64":
        case "timestamp_ms":
          data = new Float64Array(slice);
          break;
        case "i32":
          data = new Int32Array(slice);
          break;
        case "u32":
          data = new Uint32Array(slice);
          break;
        case "bool":
          data = new Uint8Array(slice);
          break;
      }
      columns.push({ type, data });
    }
  }
  return { seq, rowCount, columns };
}
function packWindowBuffer(columns, schema, startRow, rowCount, seq) {
  const colBufs = [];
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const type = schema[i].type;
    if (col instanceof ListUtf8Column) {
      const { totalItems, rowOffsets, itemOffsets, bytes: bytes2 } = col.copySlice(startRow, rowCount);
      colBufs.push({ type, bufs: [totalItems, rowOffsets, itemOffsets, bytes2] });
    } else if (col instanceof Utf8Column) {
      const { offsets, bytes: bytes2 } = col.copySlice(startRow, rowCount);
      colBufs.push({ type, bufs: [offsets, bytes2] });
    } else {
      colBufs.push({ type, bufs: [col.copySlice(startRow, rowCount)] });
    }
  }
  const headerSize = 16;
  const descriptorSize = colBufs.length * 8;
  let dataSize = 0;
  for (const { bufs } of colBufs) for (const b of bufs) dataSize += b.byteLength;
  const out = new ArrayBuffer(headerSize + descriptorSize + dataSize);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  let cur = 0;
  view.setUint32(cur, BATCH_MAGIC, true);
  cur += 4;
  view.setUint32(cur, seq, true);
  cur += 4;
  view.setUint32(cur, rowCount, true);
  cur += 4;
  view.setUint32(cur, colBufs.length, true);
  cur += 4;
  for (const { type, bufs } of colBufs) {
    let byteLen = 0;
    for (const b of bufs) byteLen += b.byteLength;
    view.setUint32(cur, TYPE_TAG[type], true);
    cur += 4;
    view.setUint32(cur, byteLen, true);
    cur += 4;
  }
  for (const { bufs } of colBufs) {
    for (const b of bufs) {
      bytes.set(new Uint8Array(b), cur);
      cur += b.byteLength;
    }
  }
  return out;
}
function resolveLayout(schema, charWidthHint, rowHeightHint, totalRows, viewportHeight) {
  const columns = schema.map((col, columnIndex) => ({
    ...col,
    computedWidth: asPixelSize(
      col.fixedWidth ?? col.maxContentChars * charWidthHint + CELL_H_PADDING * 2
    ),
    columnIndex
  }));
  return {
    columns,
    rowHeight: asPixelSize(rowHeightHint),
    totalRows,
    totalHeight: asPixelSize(totalRows * rowHeightHint),
    viewportRows: Math.ceil(viewportHeight / rowHeightHint) + 1
  };
}
var BackpressureController = class {
  constructor() {
    this.history = new RingBuffer(8);
    this.strategy = "NOMINAL";
  }
  record(renderMs) {
    this.history.push(renderMs);
    if (this.history.length < 4) return null;
    const avg = this.history.mean();
    const next = avg > 28 ? "SHED" : avg > 14 ? "BUFFER" : "NOMINAL";
    if (next === this.strategy) return null;
    this.strategy = next;
    return next;
  }
  get avgMs() {
    return this.history.mean();
  }
  get queueSnapshot() {
    return {
      strategy: this.strategy,
      queueDepth: 0,
      avgRenderMs: asMs(this.avgMs)
    };
  }
};
var _DataWorkerCore = class _DataWorkerCore {
  constructor() {
    this.schema = [];
    this.columns = [];
    this.charWidthHint = 8;
    this.rowHeightHint = 32;
    this.viewportHeight = 600;
    this.totalRows = 0;
    this.windowStart = 0;
    this.windowCount = 0;
    this.layout = null;
    this.seqCounter = 0;
    this.bp = new BackpressureController();
    this.queue = [];
    this.processing = false;
  }
  // ── Emit helper ──────────────────────────────────────────────────────────────
  emit(event, transfer = []) {
    self.postMessage(event, transfer);
  }
  // ── Command handlers ──────────────────────────────────────────────────────────
  init(cmd) {
    this.charWidthHint = cmd.charWidthHint;
    this.rowHeightHint = cmd.rowHeightHint;
    this.viewportHeight = cmd.viewportHeight;
    this.columns = cmd.schema.map((col) => {
      switch (col.type) {
        case "utf8":
          return new Utf8Column();
        case "list_utf8":
          return new ListUtf8Column();
        default:
          return new NumericColumn(col.type);
      }
    });
    this.layout = resolveLayout(cmd.schema, this.charWidthHint, this.rowHeightHint, 0, this.viewportHeight);
    this.schema = this.layout.columns;
    this.windowCount = this.layout.viewportRows;
    this.emit({ type: "LAYOUT_READY", layout: this.layout });
  }
  ingest(cmd) {
    if (this.bp.strategy === "SHED" && this.queue.length >= _DataWorkerCore.MAX_QUEUE_DEPTH) {
      this.queue.shift();
    }
    this.queue.push({ buffer: cmd.buffer, seq: cmd.seq });
    this.scheduleProcess();
  }
  setWindow(cmd) {
    this.windowStart = cmd.startRow;
    this.windowCount = cmd.rowCount;
    this.flushWindow();
  }
  resizeViewport(cmd) {
    this.viewportHeight = cmd.height;
    if (this.schema.length > 0) this.rebuildLayout();
  }
  frameAck(cmd) {
    const changed = this.bp.record(cmd.renderMs);
    if (changed !== null) {
      const state = {
        strategy: changed,
        queueDepth: this.queue.length,
        avgRenderMs: asMs(this.bp.avgMs)
      };
      this.emit({ type: "BACKPRESSURE", state });
    }
  }
  // ── Internal processing ───────────────────────────────────────────────────────
  scheduleProcess() {
    if (this.processing) return;
    this.processing = true;
    setTimeout(() => this.processQueue(), 0);
  }
  processQueue() {
    this.processing = false;
    while (this.queue.length > 0) this.ingestBatch(this.queue.shift());
    this.flushWindow();
  }
  ingestBatch(item) {
    let batch;
    try {
      batch = parseBatch(item.buffer);
    } catch (e) {
      this.emit({ type: "INGEST_ERROR", seq: asBatchSeq(item.seq), message: String(e) });
      this.emit({ type: "INGEST_ACK", seq: asBatchSeq(item.seq) });
      return;
    }
    for (let i = 0; i < Math.min(batch.columns.length, this.columns.length); i++) {
      const batchType = batch.columns[i].type;
      const storeType = this.schema[i].type;
      if (batchType !== storeType) {
        const msg = `Schema type mismatch at column ${i} ("${this.schema[i].name}"): batch encodes "${batchType}" but store expects "${storeType}". Ensure the schema passed to INIT matches the encoder's schema exactly.`;
        this.emit({ type: "INGEST_ERROR", seq: asBatchSeq(item.seq), message: msg });
        this.emit({ type: "INGEST_ACK", seq: asBatchSeq(item.seq) });
        return;
      }
    }
    for (let i = 0; i < batch.columns.length && i < this.columns.length; i++) {
      const col = batch.columns[i];
      const store = this.columns[i];
      if (col.type === "list_utf8" && store instanceof ListUtf8Column) {
        store.append(
          col.listTotalItems,
          col.listRowOffsets,
          col.listItemOffsets,
          col.listBytes,
          batch.rowCount
        );
      } else if (col.type === "utf8" && store instanceof Utf8Column) {
        store.append(col.utf8Offsets, col.utf8Bytes, batch.rowCount);
      } else if (store instanceof NumericColumn && col.data !== null) {
        store.append(col.data);
      }
    }
    this.totalRows += batch.rowCount;
    for (let i = 0; i < this.columns.length; i++) {
      const colRows = this.columns[i].rowCount;
      if (colRows !== this.totalRows) {
        const msg = `Integrity violation after batch commit: column "${this.schema[i].name}" has ${colRows} rows but totalRows=${this.totalRows}. Parallel list_utf8 columns must encode identical row counts per batch (e.g. organism_ids and organism_names arrays must have the same length).`;
        this.emit({ type: "INGEST_ERROR", seq: asBatchSeq(item.seq), message: msg });
        this.emit({ type: "INGEST_ACK", seq: asBatchSeq(item.seq) });
        return;
      }
    }
    this.rebuildLayout();
    this.emit({ type: "TOTAL_ROWS_UPDATED", totalRows: this.totalRows });
    this.emit({ type: "INGEST_ACK", seq: asBatchSeq(item.seq) });
  }
  rebuildLayout() {
    this.layout = resolveLayout(
      this.schema,
      this.charWidthHint,
      this.rowHeightHint,
      this.totalRows,
      this.viewportHeight
    );
    this.schema = this.layout.columns;
  }
  flushWindow() {
    if (!this.layout || this.totalRows === 0 || this.windowCount === 0) return;
    const start = Math.max(0, Math.min(this.windowStart, this.totalRows - 1));
    const count = Math.min(this.windowCount, this.totalRows - start);
    if (count <= 0) return;
    const seq = this.seqCounter++;
    const buffer = packWindowBuffer(this.columns, this.schema, start, count, seq);
    const win = {
      seq: asBatchSeq(seq),
      startRow: asRowIndex(start),
      rowCount: count,
      layout: this.layout,
      buffer
    };
    this.emit({ type: "WINDOW_UPDATE", window: win }, [buffer]);
  }
};
_DataWorkerCore.MAX_QUEUE_DEPTH = 64;
var DataWorkerCore = _DataWorkerCore;
var core = new DataWorkerCore();
self.onmessage = (e) => {
  const cmd = e.data;
  switch (cmd.type) {
    case "INIT":
      core.init(cmd);
      break;
    case "INGEST":
      core.ingest(cmd);
      break;
    case "SET_WINDOW":
      core.setWindow(cmd);
      break;
    case "RESIZE_VIEWPORT":
      core.resizeViewport(cmd);
      break;
    case "FRAME_ACK":
      core.frameAck(cmd);
      break;
    case "TERMINATE":
      self.close();
      break;
  }
};
