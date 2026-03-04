/**
 * Query types — shared between server query endpoint and client.
 * @module
 */

export type FilterOp =
  | { type: 'between'; low: number; high: number }
  | { type: 'in'; values: string[] }
  | { type: 'ilike'; pattern: string };

export interface FilterSpec {
  column: string;
  op: FilterOp;
}

export interface SortSpec {
  column: string;
  direction: 'asc' | 'desc';
}
