import * as react_jsx_runtime from 'react/jsx-runtime';
import { ReactNode, CSSProperties } from 'react';

declare const __brand: unique symbol;
type Brand<T, B> = T & {
    readonly [__brand]: B;
};
type RowIndex = Brand<number, "RowIndex">;
type PixelSize = Brand<number, "PixelSize">;
type Milliseconds = Brand<number, "Milliseconds">;
type BatchSeq = Brand<number, "BatchSeq">;
type PoolSlot = Brand<number, "PoolSlot">;
declare const asRowIndex: (n: number) => RowIndex;
declare const asPixelSize: (n: number) => PixelSize;
declare const asMs: (n: number) => Milliseconds;
declare const asBatchSeq: (n: number) => BatchSeq;
declare const asPoolSlot: (n: number) => PoolSlot;
type ColumnDataType = "f64" | "i32" | "u32" | "bool" | "timestamp_ms" | "utf8" | "list_utf8";
interface ColumnSchema {
    readonly name: string;
    readonly type: ColumnDataType;
    /**
     * Zero-Measurement layout hint: worst-case character count for this column.
     * Worker derives pixel width as `maxContentChars * charWidthHint + CELL_H_PADDING`.
     * Overridden when `fixedWidth` is provided.
     */
    readonly maxContentChars: number;
    readonly fixedWidth?: PixelSize;
}
/** Schema after the worker has resolved pixel geometry. */
interface ResolvedColumn extends ColumnSchema {
    readonly computedWidth: PixelSize;
    readonly columnIndex: number;
}
declare const BATCH_MAGIC: 2887631070;
declare const CELL_H_PADDING: PixelSize;
type WorkerCommand = {
    readonly type: "INIT";
    readonly schema: ColumnSchema[];
    /** Approximate monospace char width in px — drives column widths. */
    readonly charWidthHint: PixelSize;
    /** Approximate row height in px — drives rowHeight and viewportRows. */
    readonly rowHeightHint: PixelSize;
    /** Initial scroll-container height in px. */
    readonly viewportHeight: PixelSize;
} | {
    readonly type: "INGEST";
    /**
     * Packed columnar batch in the binary format above.
     * Transferred to the worker — main thread loses ownership.
     */
    readonly buffer: ArrayBuffer;
    readonly seq: BatchSeq;
} | {
    readonly type: "SET_WINDOW";
    readonly startRow: RowIndex;
    /** How many rows to include (typically viewportRows + 2 × overscan). */
    readonly rowCount: number;
} | {
    readonly type: "RESIZE_VIEWPORT";
    readonly height: PixelSize;
} | {
    /**
     * Main thread reports render time after each rAF.
     * Worker uses this to tune the backpressure strategy.
     */
    readonly type: "FRAME_ACK";
    readonly renderMs: Milliseconds;
    readonly seq: BatchSeq;
} | {
    readonly type: "TERMINATE";
};
interface ViewportLayout {
    readonly columns: ResolvedColumn[];
    readonly rowHeight: PixelSize;
    readonly totalRows: number;
    readonly totalHeight: PixelSize;
    /** Number of rows visible in the current viewport, including partial. */
    readonly viewportRows: number;
}
interface DataWindow {
    readonly seq: BatchSeq;
    readonly startRow: RowIndex;
    readonly rowCount: number;
    readonly layout: ViewportLayout;
    /**
     * Packed window buffer in the same binary format as INGEST.
     * Transferred to main thread — single zero-copy transfer.
     * Parse with buildAccessors() in virtual-chamber.tsx.
     */
    readonly buffer: ArrayBuffer;
}
/**
 * NOMINAL  — all frames within 16ms budget; full ingestion.
 * BUFFER   — frames 14–28ms; coalesce ingest queue before emitting updates.
 * SHED     — frames > 28ms; drop oldest queued batches to stay alive.
 */
type BackpressureStrategy = "NOMINAL" | "BUFFER" | "SHED";
interface BackpressureState {
    readonly strategy: BackpressureStrategy;
    readonly queueDepth: number;
    readonly avgRenderMs: Milliseconds;
}
type WorkerEvent = {
    readonly type: "LAYOUT_READY";
    readonly layout: ViewportLayout;
} | {
    readonly type: "WINDOW_UPDATE";
    /** buffer inside DataWindow is Transferable — received as detached on worker side. */
    readonly window: DataWindow;
} | {
    readonly type: "BACKPRESSURE";
    readonly state: BackpressureState;
} | {
    readonly type: "TOTAL_ROWS_UPDATED";
    readonly totalRows: number;
} | {
    readonly type: "INGEST_ERROR";
    readonly seq: BatchSeq;
    readonly message: string;
} | {
    /**
     * Emitted by the worker after each INGEST batch is committed to column
     * storage. The main-thread ingest pump awaits this before sending the
     * next batch, providing true IPC-level backpressure: at most one batch
     * in flight at a time regardless of dataset size.
     */
    readonly type: "INGEST_ACK";
    readonly seq: BatchSeq;
};
type StreamStatus = "idle" | "streaming" | "complete" | "error";
interface StoreState {
    readonly status: StreamStatus;
    readonly layout: ViewportLayout | null;
    readonly window: DataWindow | null;
    readonly backpressure: BackpressureState;
    readonly totalRows: number;
    readonly error: string | null;
}

/**
 * AtomicStore — single source of truth for the Core Stability Engine.
 *
 * Components subscribe only to their specific slice via useAtomicSlice,
 * which uses useSyncExternalStore to prevent global re-renders.
 * A component re-renders only when the slice it selected changes by reference.
 */

type Listener = () => void;
declare class AtomicStore {
    private state;
    private readonly listeners;
    readonly subscribe: (listener: Listener) => (() => void);
    private notify;
    getState(): StoreState;
    dispatch(event: WorkerEvent): void;
    /** Transition stream lifecycle status. */
    setStatus(status: StreamStatus, error?: string): void;
    private merge;
}
type EqualityFn<T> = (a: T, b: T) => boolean;
declare function useAtomicSlice<T>(store: AtomicStore, selector: (state: StoreState) => T, equalityFn?: EqualityFn<T>): T;

/**
 * useStabilityOrchestrator — golden-path hook for the Core Stability Engine.
 *
 * Responsibilities:
 *   1. Spawn + own the DataWorker lifecycle.
 *   2. Pump a ReadableStream<ArrayBuffer> → worker with INGEST_ACK backpressure:
 *      at most one batch is in-flight at a time regardless of dataset size.
 *   3. Translate scroll position into SET_WINDOW commands (worker-derived rowHeight).
 *   4. Report actual frame render time to the worker via rAF + FRAME_ACK.
 *   5. Relay viewport size changes to the worker for Zero-Measurement layout updates.
 *   6. Expose the AtomicStore for downstream components to subscribe to.
 */

interface StabilityOrchestratorOptions {
    /** Schema for the incoming data stream. */
    schema: ColumnSchema[];
    /**
     * Approximate character width in px.
     * Used by the worker's Zero-Measurement layout engine to derive column widths.
     * Match your table's font: 8px suits 14px monospace, 7px suits 14px proportional.
     */
    charWidthHint?: number;
    /**
     * Approximate row height in px. Default: 36.
     */
    rowHeightHint?: number;
    /**
     * Extra rows to render above and below the visible window. Default: 3.
     */
    overscanRows?: number;
    /**
     * Initial viewport height hint in px.
     * Overridden automatically when containerRef is attached to the scroll element.
     */
    initialViewportHeight?: number;
}
interface StabilityOrchestratorReturn {
    /** Attach to the scroll container element (the VirtualChamber outer div). */
    containerRef: (el: HTMLElement | null) => void;
    /** The single atomic store. Pass to VirtualChamber and any other subscribers. */
    store: AtomicStore;
    /**
     * Begin consuming a ReadableStream<ArrayBuffer>.
     * Each chunk must be a record batch in the standard wire format.
     * Returns a cleanup function that cancels the stream.
     *
     * Backpressure: the pump sends one batch at a time and awaits INGEST_ACK
     * from the worker before reading the next chunk. IPC queue depth is O(1).
     */
    ingest: (stream: ReadableStream<ArrayBuffer>) => () => void;
    /** Programmatically scroll to an absolute row index. */
    scrollToRow: (row: number) => void;
}
declare function useStabilityOrchestrator(options: StabilityOrchestratorOptions): StabilityOrchestratorReturn;

interface RowProxy {
    /**
     * Schema-aware accessor.
     * - utf8 columns     → string
     * - list_utf8 columns → string[]  (pre-parsed, no JSON.parse on main thread)
     * - numeric columns  → number | boolean
     * - unknown column   → null
     */
    get(column: string): string | number | boolean | string[] | null;
}
interface VirtualChamberProps {
    store: AtomicStore;
    /**
     * Render function called once per visible row.
     * Receives a RowProxy for schema-safe column access and the absolute row index.
     */
    renderRow: (row: RowProxy, rowIndex: RowIndex) => ReactNode;
    /**
     * Callback ref for the scroll container element.
     * Pass the `containerRef` returned by useStabilityOrchestrator directly.
     * Using a plain callback avoids React namespace conflicts across package boundaries.
     */
    containerRef?: (el: HTMLElement | null) => void;
    className?: string;
    style?: CSSProperties;
}
declare function VirtualChamber({ store, renderRow, containerRef, className, style }: VirtualChamberProps): react_jsx_runtime.JSX.Element | null;

/**
 * encodeRecordBatch — produce an INGEST-compatible wire buffer.
 *
 * Converts row-oriented JavaScript data into the columnar binary format
 * expected by DataWorker's INGEST command. Use this when your data source
 * yields plain objects; if your source already speaks Arrow IPC or a columnar
 * binary format, write a thin adapter that produces the same layout.
 */

type RowRecord = Record<string, unknown>;
/**
 * Encode a batch of rows into the DataWorker wire format.
 *
 * @param schema  Column definitions — types must match the runtime values.
 * @param rows    Row-oriented data. Order must match schema order.
 * @param seq     Monotonic sequence number (use asBatchSeq(i) for each call).
 * @returns       ArrayBuffer ready to transfer as an INGEST payload.
 */
declare function encodeRecordBatch(schema: ColumnSchema[], rows: RowRecord[], seq?: BatchSeq): ArrayBuffer;
/**
 * Convenience: encode a stream of row-batches into a ReadableStream<ArrayBuffer>.
 * Feed the result directly to useStabilityOrchestrator's ingest().
 *
 * @param schema   Column definitions.
 * @param batches  AsyncIterable of row arrays.
 */
declare function createRecordBatchStream(schema: ColumnSchema[], batches: AsyncIterable<RowRecord[]>): ReadableStream<ArrayBuffer>;

export { AtomicStore, BATCH_MAGIC, type BackpressureState, type BackpressureStrategy, type BatchSeq, CELL_H_PADDING, type ColumnDataType, type ColumnSchema, type DataWindow, type Milliseconds, type PixelSize, type PoolSlot, type ResolvedColumn, type RowIndex, type RowProxy, type RowRecord, type StabilityOrchestratorOptions, type StabilityOrchestratorReturn, type StoreState, type StreamStatus, type ViewportLayout, VirtualChamber, type VirtualChamberProps, type WorkerCommand, type WorkerEvent, asBatchSeq, asMs, asPixelSize, asPoolSlot, asRowIndex, createRecordBatchStream, encodeRecordBatch, useAtomicSlice, useStabilityOrchestrator };
