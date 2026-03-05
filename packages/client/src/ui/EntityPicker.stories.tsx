import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { http, HttpResponse } from 'msw';
import {
  CollectionPicker,
  OrganismPicker,
  FileTypePicker,
  TechniquePicker,
  RelationPicker,
} from './EntityPicker';

// ── Mock API responses matching real entity shapes ──────

const MOCK_ORGANISMS = [
  { id: '1', genus: 'Escherichia', species: 'coli', strain: 'K-12 MG1655', commonName: null, ncbiTaxId: 511145, referenceGenome: 'GCF_000005845.2', displayName: 'Escherichia coli K-12 MG1655', fileCount: 12, collectionCount: 3, createdAt: '2025-01-01T00:00:00Z' },
  { id: '2', genus: 'Saccharomyces', species: 'cerevisiae', strain: 'S288C', commonName: "Baker's yeast", ncbiTaxId: 559292, referenceGenome: 'GCF_000146045.2', displayName: 'Saccharomyces cerevisiae S288C', fileCount: 8, collectionCount: 2, createdAt: '2025-01-02T00:00:00Z' },
  { id: '3', genus: 'Arabidopsis', species: 'thaliana', strain: 'Col-0', commonName: 'Thale cress', ncbiTaxId: 3702, referenceGenome: 'GCF_000001735.4', displayName: 'Arabidopsis thaliana Col-0', fileCount: 5, collectionCount: 1, createdAt: '2025-01-03T00:00:00Z' },
  { id: '4', genus: 'Bacillus', species: 'subtilis', strain: '168', commonName: null, ncbiTaxId: 224308, referenceGenome: null, displayName: 'Bacillus subtilis 168', fileCount: 3, collectionCount: 1, createdAt: '2025-01-04T00:00:00Z' },
];

const MOCK_COLLECTIONS = [
  { id: '1', name: 'RNA-seq Timecourse', description: null, types: ['experiment'], metadata: null, techniques: [{ id: '1', name: 'RNA-seq' }], organisms: [{ id: '1', displayName: 'Escherichia coli K-12 MG1655' }], createdBy: null, fileCount: 6, createdAt: '2025-01-01T00:00:00Z' },
  { id: '2', name: 'ChIP-seq Peaks', description: 'Transcription factor binding sites', types: ['experiment'], metadata: null, techniques: [{ id: '2', name: 'ChIP-seq' }], organisms: [{ id: '2', displayName: 'Saccharomyces cerevisiae S288C' }], createdBy: null, fileCount: 4, createdAt: '2025-01-02T00:00:00Z' },
  { id: '3', name: 'ATAC-seq Atlas', description: null, types: ['reference'], metadata: null, techniques: [{ id: '3', name: 'ATAC-seq' }], organisms: [{ id: '3', displayName: 'Arabidopsis thaliana Col-0' }], createdBy: null, fileCount: 3, createdAt: '2025-01-03T00:00:00Z' },
];

const MOCK_TECHNIQUES = [
  { id: '1', name: 'RNA-seq', description: 'Transcriptome sequencing', defaultTags: ['expression'], createdAt: '2025-01-01T00:00:00Z' },
  { id: '2', name: 'ChIP-seq', description: 'Chromatin immunoprecipitation', defaultTags: ['binding'], createdAt: '2025-01-02T00:00:00Z' },
  { id: '3', name: 'ATAC-seq', description: 'Open chromatin profiling', defaultTags: ['accessibility'], createdAt: '2025-01-03T00:00:00Z' },
  { id: '4', name: 'Hi-C', description: 'Chromosome conformation capture', defaultTags: ['3d-genome'], createdAt: '2025-01-04T00:00:00Z' },
];

const MOCK_FILE_TYPES = [
  { id: '1', name: 'parquet', description: 'Columnar storage format', createdAt: '2025-01-01T00:00:00Z' },
  { id: '2', name: 'csv', description: 'Comma-separated values', createdAt: '2025-01-02T00:00:00Z' },
  { id: '3', name: 'gff', description: 'General Feature Format', createdAt: '2025-01-03T00:00:00Z' },
  { id: '4', name: 'fasta', description: 'Nucleotide/protein sequences', createdAt: '2025-01-04T00:00:00Z' },
  { id: '5', name: 'fastq', description: 'Sequences with quality scores', createdAt: '2025-01-05T00:00:00Z' },
];

const MOCK_RELATION_TYPES = [
  { id: '1', name: 'derived_from', description: 'This file was derived from another', createdAt: '2025-01-01T00:00:00Z' },
  { id: '2', name: 'replicate_of', description: 'Biological or technical replicate', createdAt: '2025-01-02T00:00:00Z' },
  { id: '3', name: 'control_for', description: 'Control sample for an experiment', createdAt: '2025-01-03T00:00:00Z' },
];

// ── MSW handlers ────────────────────────────────────────

const handlers = [
  http.get('/api/organisms', () => HttpResponse.json(MOCK_ORGANISMS)),
  http.get('/api/collections', () => HttpResponse.json(MOCK_COLLECTIONS)),
  http.get('/api/techniques', () => HttpResponse.json(MOCK_TECHNIQUES)),
  http.get('/api/file-types', () => HttpResponse.json(MOCK_FILE_TYPES)),
  http.get('/api/relation-types', () => HttpResponse.json(MOCK_RELATION_TYPES)),
];

const meta = {
  title: 'Interactive/EntityPicker',
  parameters: {
    msw: { handlers },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function PickerStory({
  children,
}: {
  children: (props: { value: string; onChange: (v: string) => void }) => React.ReactNode;
}) {
  const [value, setValue] = useState('');
  return <div style={{ width: 280 }}>{children({ value, onChange: setValue })}</div>;
}

export const Collection: Story = {
  name: 'CollectionPicker',
  render: () => (
    <PickerStory>
      {({ value, onChange }) => (
        <CollectionPicker value={value} onValueChange={onChange} placeholder="Collection..." />
      )}
    </PickerStory>
  ),
};

export const Organism: Story = {
  name: 'OrganismPicker',
  render: () => (
    <PickerStory>
      {({ value, onChange }) => (
        <OrganismPicker value={value} onValueChange={onChange} placeholder="Organism..." />
      )}
    </PickerStory>
  ),
};

export const FileType: Story = {
  name: 'FileTypePicker',
  render: () => (
    <PickerStory>
      {({ value, onChange }) => (
        <FileTypePicker value={value} onValueChange={onChange} placeholder="File type..." />
      )}
    </PickerStory>
  ),
};

export const Technique: Story = {
  name: 'TechniquePicker',
  render: () => (
    <PickerStory>
      {({ value, onChange }) => (
        <TechniquePicker value={value} onValueChange={onChange} placeholder="Technique..." />
      )}
    </PickerStory>
  ),
};

export const Relation: Story = {
  name: 'RelationPicker',
  render: () => (
    <PickerStory>
      {({ value, onChange }) => (
        <RelationPicker value={value} onValueChange={onChange} placeholder="Relation..." />
      )}
    </PickerStory>
  ),
};
