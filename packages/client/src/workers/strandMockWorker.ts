import { StrandWriter } from '@strand/core';
import { INTERN_HANDLES } from '../strand/schema';

// ── Mock data helpers ────────────────────────────────────

const CHROMS = Array.from({ length: 34 }, (_, i) => `contig_${i < 12 ? i + 22 : i + 90}`);
const STRANDS = ['+', '-'] as const;
const MATCHED_PAMS = ['AGG', 'TGG', 'CGG', 'GGG'] as const;
const BASES = 'ACGT';

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randFloat(min: number, max: number) {
  return Math.random() * (max - min) + min;
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randSeq(len: number) {
  return Array.from({ length: len }, () => BASES[randInt(0, 3)]).join('');
}
function hexId() {
  return Math.random().toString(16).slice(2, 10);
}

// Intern handle lookup (throws on miss — all values must be in the table)
function h(value: string): number {
  const handle = INTERN_HANDLES[value];
  if (handle === undefined) throw new Error(`Missing intern handle: ${value}`);
  return handle;
}

// ── Generate one flat record for StrandWriter ────────────

function generateRecord(): Record<string, number | string> {
  const chrom = pick(CHROMS);
  const start = randInt(1000, 200000);
  const end = start + 23;
  const strand = pick(STRANDS);
  const offTargets = randInt(0, 88);
  const totalSites = offTargets + 1;
  const score = offTargets * 1.0;
  const spacer = randSeq(20);
  const matched = pick(MATCHED_PAMS);
  const featureStart = start + randInt(-500, 0);
  const featureEnd = featureStart + 500;
  const overlap = randInt(1, 23);
  const offset = randInt(-22, 499);
  const relativePos = Math.round(randFloat(-10.5, 1.0) * 1000) / 1000;
  const signedDistance = randInt(-522, 21);

  // Field names are f0..f23 — indices match COLUMNS order in schema.ts
  return {
    f0:  h(chrom),
    f1:  start,
    f2:  end,
    f3:  h(strand),
    f4:  score,
    f5:  hexId(),
    f6:  h('NGG'),
    f7:  h(matched),
    f8:  hexId(),
    f9:  end - 3,
    f10: end,
    f11: spacer,
    f12: spacer + matched,
    f13: totalSites,
    f14: offTargets,
    f15: '',
    f16: h('promoter'),
    f17: featureStart,
    f18: featureEnd,
    f19: h(pick(STRANDS)),
    f20: overlap,
    f21: offset,
    f22: signedDistance,
    f23: relativePos,
  };
}

// ── Worker message handler ───────────────────────────────

interface InitMessage {
  type: 'init';
  sab: SharedArrayBuffer;
  recordCount: number;
  batchSize: number;
}

self.onmessage = (e: MessageEvent<InitMessage>) => {
  const { sab, recordCount, batchSize } = e.data;

  try {
    const writer = new StrandWriter(sab);
    writer.begin();

    let written = 0;
    while (written < recordCount) {
      const count = Math.min(batchSize, recordCount - written);
      const batch: Record<string, number | string>[] = [];
      for (let i = 0; i < count; i++) {
        batch.push(generateRecord());
      }
      writer.writeRecordBatch(batch);
      written += count;
    }

    writer.finalize();
    self.postMessage({ type: 'done', totalWritten: written });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) });
  }
};
