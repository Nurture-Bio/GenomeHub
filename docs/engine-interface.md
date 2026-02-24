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
    "id": "overlay",
    "name": "Spatial Overlay",
    "description": "Spatial join of two region sets.",
    "parameters": [
      {
        "name": "query",
        "type": "file",
        "required": true,
        "description": "Regions to enrich",
        "accept": ["json", "bed"]
      },
      {
        "name": "name_tag",
        "type": "string",
        "required": false,
        "default": "feature_type",
        "description": "Tag key for promoted name"
      }
    ],
    "returns": {
      "type": "file",
      "description": "Regions with merged tags"
    }
  }
]
```

### Parameter types

Only two:

| Type     | What GenomeHub does                                    |
| -------- | ------------------------------------------------------ |
| `file`   | Downloads the file from S3, uploads it to the engine via `POST /api/files/upload`. Sends the engine's returned `id` in the dispatch body. |
| `string` | Passes the value through as-is.                        |

The `accept` array on file params filters the file picker by format (e.g. `["json", "bed"]`). Omit to accept any file.

GenomeHub doesn't know or care what the engine does with the file — track, genome, annotation, whatever. That's the engine's problem.

### `POST /api/files/upload`
Multipart form upload. Single field: `file`.

Returns:
```json
{"id": "uuid"}
```

### `GET /api/methods/:id`
Returns the schema for a single method (same shape as an element of the array above). Used by the server to discover parameter types before dispatch.

### `POST /api/methods/:id`
Execute a method. Body keys match parameter names, values are engine file IDs (from upload) or strings.

```json
{"query": "engine-file-id", "reference": "engine-file-id", "name_tag": "feature_type"}
```

Returns:
```json
{"id": "uuid"}
```

The returned `id` is an engine-side file ID for the result.

### `GET /api/tracks/:id/data`
Returns the result data as JSON. GenomeHub downloads this, stores it as a new file in S3.

## GenomeHub dispatch flow

```
User clicks "Run" in EnginePanel
        │
        ▼
  For each file param:
    1. Download file bytes from S3
    2. POST to engine /api/files/upload
    3. Get back {id}
        │
        ▼
  POST /api/methods/:methodId
    body: {paramName: engineFileId, ...}
    response: {id}
        │
        ▼
  GET /api/tracks/:id/data
    Download result JSON
        │
        ▼
  Store result as new GenomicFile in S3
  Create provenance edges (result → inputs)
  Return {fileId, filename} to client
```

## Schema reference

See `engine-methods-schema.json` for the formal JSON Schema.
