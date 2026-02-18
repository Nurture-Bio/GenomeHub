export type Technique =
  | 'ChIP-seq' | 'ATAC-seq' | 'RNA-seq' | 'MNase-seq' | 'WGS'
  | 'Tn-seq' | 'Hi-C' | 'CUT&Tag' | 'CUT&Run' | 'CRISPR-screen' | 'other';

export interface TechniqueMeta {
  label: string;
  color: string;
  bg:    string;
  description: string;
}

export const TECHNIQUE_META: Record<Technique, TechniqueMeta> = {
  'ChIP-seq':      { label: 'ChIP-seq',      color: 'oklch(0.75 0.18 30)',  bg: 'oklch(0.20 0.04 30)',  description: 'Chromatin immunoprecipitation sequencing' },
  'ATAC-seq':      { label: 'ATAC-seq',      color: 'oklch(0.75 0.18 145)', bg: 'oklch(0.20 0.04 145)', description: 'Assay for transposase-accessible chromatin' },
  'RNA-seq':       { label: 'RNA-seq',       color: 'oklch(0.75 0.18 270)', bg: 'oklch(0.20 0.04 270)', description: 'Transcriptome sequencing' },
  'MNase-seq':     { label: 'MNase-seq',     color: 'oklch(0.75 0.18 80)',  bg: 'oklch(0.20 0.04 80)',  description: 'Micrococcal nuclease sequencing' },
  'WGS':           { label: 'WGS',           color: 'oklch(0.75 0.18 200)', bg: 'oklch(0.20 0.04 200)', description: 'Whole genome sequencing' },
  'Tn-seq':        { label: 'Tn-seq',        color: 'oklch(0.75 0.18 340)', bg: 'oklch(0.20 0.04 340)', description: 'Transposon insertion sequencing' },
  'Hi-C':          { label: 'Hi-C',          color: 'oklch(0.75 0.18 55)',  bg: 'oklch(0.20 0.04 55)',  description: 'Chromosome conformation capture' },
  'CUT&Tag':       { label: 'CUT&Tag',       color: 'oklch(0.75 0.18 110)', bg: 'oklch(0.20 0.04 110)', description: 'Cleavage under targets & tagmentation' },
  'CUT&Run':       { label: 'CUT&Run',       color: 'oklch(0.75 0.18 175)', bg: 'oklch(0.20 0.04 175)', description: 'Cleavage under targets & release using nuclease' },
  'CRISPR-screen': { label: 'CRISPR',        color: 'oklch(0.75 0.18 310)', bg: 'oklch(0.20 0.04 310)', description: 'CRISPR genetic screen' },
  'other':         { label: 'Other',         color: 'oklch(0.55 0 0)',      bg: 'oklch(0.18 0 0)',      description: 'Other technique' },
};

export const TECHNIQUE_LIST: Technique[] = Object.keys(TECHNIQUE_META) as Technique[];
