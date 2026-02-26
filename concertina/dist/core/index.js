// src/core/use-stability-orchestrator.ts
import {
  useCallback as useCallback2,
  useEffect,
  useMemo,
  useRef as useRef2,
  useState
} from "react";

// src/core/atomic-store.ts
import { useCallback, useRef, useSyncExternalStore } from "react";

// src/core/types.ts
var asRowIndex = (n) => n;
var asPixelSize = (n) => n;
var asMs = (n) => n;
var asBatchSeq = (n) => n;
var asPoolSlot = (n) => n;
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

// src/core/atomic-store.ts
var AtomicStore = class {
  constructor() {
    this.state = INITIAL_STORE_STATE;
    this.listeners = /* @__PURE__ */ new Set();
    // useSyncExternalStore-compatible subscribe
    this.subscribe = (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    };
  }
  notify() {
    for (const l of this.listeners) l();
  }
  getState() {
    return this.state;
  }
  // ── Dispatch: accepts worker events and applies them to state ────────────────
  dispatch(event) {
    switch (event.type) {
      case "LAYOUT_READY":
        this.merge({ layout: event.layout, status: "streaming" });
        break;
      case "WINDOW_UPDATE":
        this.merge({
          window: event.window,
          layout: event.window.layout,
          totalRows: event.window.layout.totalRows
        });
        break;
      case "BACKPRESSURE":
        this.merge({ backpressure: event.state });
        break;
      case "TOTAL_ROWS_UPDATED":
        if (this.state.totalRows !== event.totalRows) {
          this.merge({ totalRows: event.totalRows });
        }
        break;
      case "INGEST_ERROR":
        this.merge({
          status: "error",
          error: `Batch ${event.seq}: ${event.message}`
        });
        break;
    }
  }
  /** Transition stream lifecycle status. */
  setStatus(status, error) {
    this.merge({ status, error: error ?? this.state.error });
  }
  merge(patch) {
    const next = { ...this.state, ...patch };
    this.state = next;
    this.notify();
  }
};
function useAtomicSlice(store, selector, equalityFn = Object.is) {
  const selectorRef = useRef(selector);
  const equalityRef = useRef(equalityFn);
  selectorRef.current = selector;
  equalityRef.current = equalityFn;
  const cachedSlice = useRef(null);
  const getSnapshot = useCallback(() => {
    const next = selectorRef.current(store.getState());
    if (cachedSlice.current !== null && equalityRef.current(cachedSlice.current.value, next)) {
      return cachedSlice.current.value;
    }
    cachedSlice.current = { value: next };
    return next;
  }, [store]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

// src/core/use-stability-orchestrator.ts
function useStabilityOrchestrator(options) {
  const {
    schema,
    charWidthHint = 8,
    rowHeightHint = 36,
    overscanRows = 3,
    initialViewportHeight = typeof window !== "undefined" ? window.innerHeight : 600
  } = options;
  const [store] = useState(() => new AtomicStore());
  const workerRef = useRef2(null);
  const containerRef_internal = useRef2(null);
  const layoutRef = useRef2(null);
  const seqRef = useRef2(asBatchSeq(0));
  const roRef = useRef2(null);
  const schemaRef = useRef2(schema);
  schemaRef.current = schema;
  const ackResolversRef = useRef2(/* @__PURE__ */ new Map());
  useEffect(() => {
    const worker = new Worker(
      new URL("./data-worker.js", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;
    worker.onmessage = (e) => {
      const event = e.data;
      if (event.type === "INGEST_ACK") {
        const resolver = ackResolversRef.current.get(event.seq);
        resolver?.resolve();
        ackResolversRef.current.delete(event.seq);
        return;
      }
      store.dispatch(event);
      if (event.type === "WINDOW_UPDATE") {
        layoutRef.current = event.window.layout;
        seqRef.current = event.window.seq;
      }
    };
    worker.onerror = (e) => {
      store.setStatus("error", `Worker error: ${e.message}`);
      const err = new Error(`Worker crashed: ${e.message ?? "unknown error"}`);
      ackResolversRef.current.forEach(({ reject }) => reject(err));
      ackResolversRef.current.clear();
    };
    const initCmd = {
      type: "INIT",
      schema: schemaRef.current,
      charWidthHint: asPixelSize(charWidthHint),
      rowHeightHint: asPixelSize(rowHeightHint),
      viewportHeight: asPixelSize(initialViewportHeight)
    };
    worker.postMessage(initCmd);
    return () => {
      worker.postMessage({ type: "TERMINATE" });
      worker.terminate();
      workerRef.current = null;
      ackResolversRef.current.forEach(({ resolve }) => resolve());
      ackResolversRef.current.clear();
    };
  }, []);
  useEffect(() => {
    const start = performance.now();
    let rafId;
    rafId = requestAnimationFrame(() => {
      const renderMs = asMs(performance.now() - start);
      workerRef.current?.postMessage({
        type: "FRAME_ACK",
        renderMs,
        seq: seqRef.current
      });
    });
    return () => cancelAnimationFrame(rafId);
  });
  const handleScroll = useCallback2(() => {
    const el = containerRef_internal.current;
    const lay = layoutRef.current;
    if (!el || !lay || lay.rowHeight === 0) return;
    const startRow = asRowIndex(Math.floor(el.scrollTop / lay.rowHeight));
    const rowCount = lay.viewportRows + overscanRows * 2;
    workerRef.current?.postMessage({
      type: "SET_WINDOW",
      startRow,
      rowCount
    });
  }, [overscanRows]);
  const containerRef = useCallback2(
    (el) => {
      if (containerRef_internal.current) {
        containerRef_internal.current.removeEventListener("scroll", handleScroll);
        roRef.current?.disconnect();
        roRef.current = null;
      }
      containerRef_internal.current = el;
      if (!el) return;
      el.addEventListener("scroll", handleScroll, { passive: true });
      const initialH = asPixelSize(el.getBoundingClientRect().height || initialViewportHeight);
      workerRef.current?.postMessage({
        type: "RESIZE_VIEWPORT",
        height: initialH
      });
      const ro = new ResizeObserver(([entry]) => {
        const h = asPixelSize(
          entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
        );
        workerRef.current?.postMessage({
          type: "RESIZE_VIEWPORT",
          height: h
        });
      });
      ro.observe(el);
      roRef.current = ro;
    },
    [handleScroll, initialViewportHeight]
  );
  const ingest = useCallback2(
    (stream) => {
      const controller = new AbortController();
      const reader = stream.getReader();
      let batchSeq = 0;
      store.setStatus("streaming");
      const pump = async () => {
        try {
          while (!controller.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) {
              store.setStatus("complete");
              return;
            }
            const seq = asBatchSeq(batchSeq++);
            const worker = workerRef.current;
            if (!worker) {
              store.setStatus("error", "Worker not initialized");
              return;
            }
            const ack = new Promise((resolve, reject) => {
              ackResolversRef.current.set(seq, { resolve, reject });
              controller.signal.addEventListener(
                "abort",
                () => {
                  ackResolversRef.current.delete(seq);
                  reject(new DOMException("Aborted", "AbortError"));
                },
                { once: true }
              );
            });
            worker.postMessage(
              { type: "INGEST", buffer: value, seq },
              [value]
            );
            await ack;
          }
        } catch (e) {
          if (!controller.signal.aborted) {
            store.setStatus("error", String(e));
          }
        } finally {
          reader.releaseLock();
        }
      };
      void pump();
      return () => {
        controller.abort();
        reader.cancel().catch(() => void 0);
      };
    },
    [store]
  );
  const scrollToRow = useCallback2((row) => {
    const el = containerRef_internal.current;
    const lay = layoutRef.current;
    if (!el || !lay) return;
    el.scrollTo({ top: row * lay.rowHeight, behavior: "smooth" });
    workerRef.current?.postMessage({
      type: "SET_WINDOW",
      startRow: asRowIndex(Math.max(0, row - overscanRows)),
      rowCount: lay.viewportRows + overscanRows * 2
    });
  }, [overscanRows]);
  return useMemo(
    () => ({ containerRef, store, ingest, scrollToRow }),
    [containerRef, store, ingest, scrollToRow]
  );
}

// src/core/virtual-chamber.tsx
import {
  useMemo as useMemo2
} from "react";
import { jsx, jsxs } from "react/jsx-runtime";
function buildAccessors(buffer, rowCount) {
  if (buffer.byteLength < 16) return null;
  const view = new DataView(buffer);
  const magic = view.getUint32(0, true);
  if (magic !== BATCH_MAGIC) return null;
  const colCount = view.getUint32(12, true);
  const descriptors = [];
  let cursor = 16;
  for (let i = 0; i < colCount; i++) {
    const typeTag = view.getUint32(cursor, true);
    cursor += 4;
    const byteLen = view.getUint32(cursor, true);
    cursor += 4;
    const type = TAG_TO_TYPE[typeTag];
    if (!type) return null;
    descriptors.push({ type, byteLen });
  }
  const accessors = [];
  for (const { type, byteLen } of descriptors) {
    const slice = buffer.slice(cursor, cursor + byteLen);
    cursor += byteLen;
    if (type === "utf8") {
      const offsetByteLen = (rowCount + 1) * 4;
      accessors.push({
        kind: "utf8",
        offsets: new Uint32Array(slice.slice(0, offsetByteLen)),
        bytes: new Uint8Array(slice.slice(offsetByteLen)),
        decoder: new TextDecoder()
      });
    } else if (type === "list_utf8") {
      let off = 0;
      const totalItems = new DataView(slice).getUint32(0, true);
      off += 4;
      const rowOffsets = new Uint32Array(slice.slice(off, off + (rowCount + 1) * 4));
      off += (rowCount + 1) * 4;
      const itemOffsets = new Uint32Array(slice.slice(off, off + (totalItems + 1) * 4));
      off += (totalItems + 1) * 4;
      const bytes = new Uint8Array(slice.slice(off));
      accessors.push({ kind: "list_utf8", rowOffsets, itemOffsets, bytes, decoder: new TextDecoder() });
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
      accessors.push({ kind: "numeric", type, data });
    }
  }
  return accessors;
}
function buildRowProxy(accessors, schema, localRow) {
  return {
    get(column) {
      const idx = schema.findIndex((c) => c.name === column);
      if (idx === -1 || idx >= accessors.length) return null;
      const acc = accessors[idx];
      if (acc.kind === "utf8") {
        const start = acc.offsets[localRow];
        const end = acc.offsets[localRow + 1];
        return acc.decoder.decode(acc.bytes.subarray(start, end));
      }
      if (acc.kind === "list_utf8") {
        const startItem = acc.rowOffsets[localRow];
        const endItem = acc.rowOffsets[localRow + 1];
        const result = [];
        for (let j = startItem; j < endItem; j++) {
          const byteStart = acc.itemOffsets[j];
          const byteEnd = acc.itemOffsets[j + 1];
          result.push(acc.decoder.decode(acc.bytes.subarray(byteStart, byteEnd)));
        }
        return result;
      }
      const val = acc.data[localRow];
      if (val === void 0) return null;
      if (acc.type === "bool") return val !== 0;
      return val;
    }
  };
}
function buildPoolAssignments(win, layout, poolSize) {
  const assignments = [];
  for (let i = 0; i < win.rowCount; i++) {
    const rowIndex = win.startRow + i;
    assignments.push({
      poolSlot: asPoolSlot(i % poolSize),
      rowIndex: asRowIndex(rowIndex),
      localIndex: i,
      y: rowIndex * layout.rowHeight
    });
  }
  return assignments;
}
var OVERSCAN_ROWS = 3;
function VirtualChamber({ store, renderRow, containerRef, className, style }) {
  const layout = useAtomicSlice(store, (s) => s.layout);
  const win = useAtomicSlice(store, (s) => s.window);
  const accessors = useMemo2(
    () => win ? buildAccessors(win.buffer, win.rowCount) : null,
    [win]
  );
  const poolSize = layout ? layout.viewportRows + OVERSCAN_ROWS * 2 : 0;
  const assignments = useMemo2(
    () => win && layout ? buildPoolAssignments(win, layout, poolSize) : [],
    [win, layout, poolSize]
  );
  if (!layout) return null;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ref: containerRef,
      className,
      style: {
        position: "relative",
        overflow: "auto",
        contain: "strict",
        ...style
      },
      children: [
        /* @__PURE__ */ jsx(
          "div",
          {
            "aria-hidden": true,
            style: { height: layout.totalHeight, pointerEvents: "none" }
          }
        ),
        accessors !== null && assignments.map(({ poolSlot, rowIndex, localIndex, y }) => /* @__PURE__ */ jsx(
          "div",
          {
            role: "row",
            "aria-rowindex": rowIndex + 1,
            style: {
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: layout.rowHeight,
              transform: `translateY(${y}px)`,
              willChange: "transform",
              contain: "layout style"
            },
            children: renderRow(
              buildRowProxy(accessors, layout.columns, localIndex),
              rowIndex
            )
          },
          poolSlot
        ))
      ]
    }
  );
}

// src/core/encode-record-batch.ts
function encodeRecordBatch(schema, rows, seq = asBatchSeq(0)) {
  const rowCount = rows.length;
  const colCount = schema.length;
  const encoder = new TextEncoder();
  const colBufs = [];
  for (const col of schema) {
    const vals = rows.map((r) => r[col.name]);
    switch (col.type) {
      case "f64":
      case "timestamp_ms": {
        const data = new Float64Array(rowCount);
        for (let i = 0; i < rowCount; i++) data[i] = Number(vals[i] ?? 0);
        colBufs.push({ type: col.type, bufs: [data.buffer] });
        break;
      }
      case "i32": {
        const data = new Int32Array(rowCount);
        for (let i = 0; i < rowCount; i++) data[i] = Math.trunc(Number(vals[i] ?? 0));
        colBufs.push({ type: "i32", bufs: [data.buffer] });
        break;
      }
      case "u32": {
        const data = new Uint32Array(rowCount);
        for (let i = 0; i < rowCount; i++) data[i] = Math.trunc(Number(vals[i] ?? 0)) >>> 0;
        colBufs.push({ type: "u32", bufs: [data.buffer] });
        break;
      }
      case "bool": {
        const data = new Uint8Array(rowCount);
        for (let i = 0; i < rowCount; i++) data[i] = vals[i] ? 1 : 0;
        colBufs.push({ type: "bool", bufs: [data.buffer] });
        break;
      }
      case "utf8": {
        const encoded = [];
        let totalBytes = 0;
        for (const val of vals) {
          const str = val == null ? "" : String(val);
          const enc = encoder.encode(str);
          encoded.push(enc);
          totalBytes += enc.byteLength;
        }
        const offsets = new Uint32Array(rowCount + 1);
        const bytes = new Uint8Array(totalBytes);
        let cursor = 0;
        offsets[0] = 0;
        for (let i = 0; i < rowCount; i++) {
          const enc = encoded[i];
          bytes.set(enc, cursor);
          cursor += enc.byteLength;
          offsets[i + 1] = cursor;
        }
        colBufs.push({
          type: "utf8",
          bufs: [offsets.buffer, bytes.buffer]
        });
        break;
      }
      case "list_utf8": {
        const rowArrays = vals.map(
          (v) => Array.isArray(v) ? v.map(String) : []
        );
        const encodedItems = rowArrays.map(
          (arr) => arr.map((s) => encoder.encode(s))
        );
        let totalItems = 0;
        let totalBytes = 0;
        for (const items of encodedItems) {
          totalItems += items.length;
          for (const enc of items) totalBytes += enc.byteLength;
        }
        const header = new Uint32Array([totalItems]);
        const rowOffsets = new Uint32Array(rowCount + 1);
        const itemOffsets = new Uint32Array(totalItems + 1);
        const bytes = new Uint8Array(totalBytes);
        let itemIdx = 0;
        let byteIdx = 0;
        rowOffsets[0] = 0;
        itemOffsets[0] = 0;
        for (let r = 0; r < rowCount; r++) {
          const items = encodedItems[r];
          for (const enc of items) {
            bytes.set(enc, byteIdx);
            byteIdx += enc.byteLength;
            itemOffsets[itemIdx + 1] = byteIdx;
            itemIdx++;
          }
          rowOffsets[r + 1] = itemIdx;
        }
        colBufs.push({
          type: "list_utf8",
          bufs: [
            header.buffer,
            rowOffsets.buffer,
            itemOffsets.buffer,
            bytes.buffer
          ]
        });
        break;
      }
    }
  }
  const headerSize = 16;
  const descriptorSize = colCount * 8;
  let dataSize = 0;
  for (const { bufs } of colBufs) for (const b of bufs) dataSize += b.byteLength;
  const out = new ArrayBuffer(headerSize + descriptorSize + dataSize);
  const view = new DataView(out);
  const outBytes = new Uint8Array(out);
  let cur = 0;
  view.setUint32(cur, BATCH_MAGIC, true);
  cur += 4;
  view.setUint32(cur, seq, true);
  cur += 4;
  view.setUint32(cur, rowCount, true);
  cur += 4;
  view.setUint32(cur, colCount, true);
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
      outBytes.set(new Uint8Array(b), cur);
      cur += b.byteLength;
    }
  }
  return out;
}
function createRecordBatchStream(schema, batches) {
  let seq = 0;
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const rows of batches) {
          controller.enqueue(encodeRecordBatch(schema, rows, asBatchSeq(seq++)));
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    }
  });
}
export {
  AtomicStore,
  BATCH_MAGIC,
  CELL_H_PADDING,
  VirtualChamber,
  asBatchSeq,
  asMs,
  asPixelSize,
  asPoolSlot,
  asRowIndex,
  createRecordBatchStream,
  encodeRecordBatch,
  useAtomicSlice,
  useStabilityOrchestrator
};
