# Engine ↔ GenomeHub Interface

How GenomeHub talks to engines. This is the full contract — engines implement these endpoints, GenomeHub orchestrates the data flow.

## Engine endpoints (what the engine exposes)

### `GET /api/health`
Returns `{"status": "ok"}`. GenomeHub polls this to show engine status.

### `GET /api/methods`
Returns an array of method schemas. GenomeHub builds UI from this.

```json
[
  {
    "id": "design_library",
    "name": "Library Design",
    "description": "Design and score a CRISPR guide library targeting gene promoters.",
    "async": true,
    "steps": [
      { "key": "scanning",  "label": "Scanning genome" },
      { "key": "scoring",   "label": "Scoring guides" },
      { "key": "filtering", "label": "Filtering results" }
    ],
    "parameters": [
      {
        "name": "genome",
        "type": "file",
        "required": true,
        "description": "Target genome",
        "accept": ["gb", "gbk", "gbff", "genbank", "fa", "fasta", "fna"]
      },
      {
        "name": "preset",
        "type": "select",
        "required": false,
        "default": "spcas9",
        "description": "CRISPR nuclease preset",
        "options": [
          {
            "value": "spcas9",
            "label": "SpCas9",
            "description": "Streptococcus pyogenes Cas9. The most widely used CRISPR nuclease.",
            "parameters": {"pam": "NGG", "spacer_len": 20, "pam_direction": "downstream"}
          },
          {
            "value": "cas12a",
            "label": "Cas12a",
            "description": "Cas12a (Cpf1). Produces staggered double-strand breaks.",
            "parameters": {"pam": "TTTN", "spacer_len": 24, "pam_direction": "upstream"}
          }
        ]
      },
      {
        "name": "mismatches",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Max mismatches for off-target scoring (0-3)"
      }
    ],
    "returns": {
      "type": "file",
      "description": "Scored guide library"
    }
  }
]
```

### Parameter types

| Type      | What GenomeHub does                                    |
| --------- | ------------------------------------------------------ |
| `file`    | Downloads the file from storage, uploads it to the engine via `POST /api/files/upload`. Sends the engine's returned `id` in the dispatch body. |
| `string`  | Renders a text input. Passes the value through as-is.  |
| `integer` | Renders a text input. Passes the value through as-is.  |
| `select`  | Renders a dropdown from the `options` array. Sends the selected `value` as a string in the dispatch body. |

The `accept` array on file params filters the file picker by format (e.g. `["gb", "fa"]`). Omit to accept any file.

#### `select` options

Each option has `value`, `label`, and optional `description` and `parameters`:

```json
{
  "value": "spcas9",
  "label": "SpCas9",
  "description": "Streptococcus pyogenes Cas9. The most widely used CRISPR nuclease.",
  "parameters": {"pam": "NGG", "spacer_len": 20, "pam_direction": "downstream"}
}
```

- `label` — displayed in the dropdown
- `value` — sent in the dispatch body
- `description` — shown as a subtitle
- `parameters` — displayed as read-only key–value badges when the option is selected, so the user sees what the preset configures

`default` on the parameter selects the initial option.

GenomeHub doesn't know or care what the engine does with its parameters — presets, genomes, nucleases, whatever. That's the engine's problem.

### `POST /api/files/upload`
Multipart form upload. Single field: `file`.

Returns:
```json
{"id": "uuid"}
```

### `GET /api/methods/:id`
Returns the schema for a single method (same shape as an element of the array above). Used by the server to discover parameter types before dispatch.

### `POST /api/methods/:id`
Execute a method. Body keys match parameter names — values are engine file IDs (from upload), selected option values, or plain strings.

```json
{"genome": "engine-file-id", "preset": "spcas9", "mismatches": 0}
```

#### Sync response (200)

The engine returns the result directly as a streaming body. GenomeHub reads the `Content-Type` header to determine the file extension and pipes the body to storage.

#### Async response (202)

The engine returns a job ID. GenomeHub polls for completion.

```json
{"job_id": "uuid"}
```

### `GET /api/jobs/:id`
Poll job status. Returns:

```json
{
  "status": "running",
  "step": "scoring",
  "progress": {
    "pct_complete": 0.45,
    "rate_per_sec": 12.3,
    "eta_seconds": 30
  },
  "stage": "Off-target analysis, pass 2 of 3",
  "items": { "complete": 150, "total": 500 },
  "error": null
}
```

`status` is one of `queued`, `running`, `complete`, `failed`. Progress fields may be `null` while queued.

| Field | Purpose |
|-------|---------|
| `step` | Key matching one of the method's `steps[].key`. Tells the stepper which dot is active. Optional. |
| `stage` | Free-text sublabel within the current step. Rendered below the step label. Optional. |
| `items` | Discrete n/x counter (`{ complete, total }`). Rendered as secondary progress. Optional. |
| `progress.pct_complete` | Per-step completion (0–1). A progress bar appears above the stepper when non-null. Resets when `step` changes. |

All new fields are optional and nullable. Engines that don't report them work exactly as before.

### Method steps (optional)

Engines can declare internal phases in their method schema:

```json
{
  "steps": [
    { "key": "scanning",  "label": "Scanning genome" },
    { "key": "scoring",   "label": "Scoring guides" },
    { "key": "filtering", "label": "Filtering results" }
  ]
}
```

GenomeHub wraps these with hub bookend steps to build the full stepper:

```
[Dispatching]  [engine step 1]  ...  [engine step N]  [Saving result]  [Complete]
    hub              engine                engine           hub            hub
```

If `steps` is omitted, GenomeHub defaults to a single `[{ key: "processing", label: "Processing" }]` step.

### `GET /api/jobs/:id/stream`
Fetch completed job result as a streaming body. GenomeHub pipes this to storage. The `Content-Type` header determines the file extension. GenomeHub owns the filename — the engine does not set `Content-Disposition`.

### `DELETE /api/jobs/:id`
Cancel a running job (best-effort).

## GenomeHub dispatch flow

```
User clicks "Run" in EnginePanel
        │
        ▼
  For each file param:
    1. Read file from storage (S3 or local disk)
    2. POST to engine /api/files/upload (multipart)
    3. Get back {id}
        │
        ▼
  POST /api/methods/:methodId
    body: {paramName: engineFileId, ...}
        │
        ├── 200 (sync): pipe response body → storage
        │
        └── 202 (async): get {job_id}
              │
              ▼
            Poll GET /api/jobs/:id until complete
              │
              ▼
            GET /api/jobs/:id/stream → pipe to storage
        │
        ▼
  Create GenomicFile record
  Create provenance edges (result → inputs)
  Return {fileId, filename} to client
```
