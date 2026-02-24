# Engine ↔ GenomeHub Interface

How GenomeHub talks to engines. This is the full contract — engines implement these endpoints, GenomeHub orchestrates the data flow. Engines deploy independently and never touch S3 or AWS. GenomeHub proxies all file data.

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

| Type     | What GenomeHub sends                                   |
| -------- | ------------------------------------------------------ |
| `file`   | A presigned S3 download URL. The engine fetches the file directly from S3 — no proxy, no double transfer. |
| `string` | Plain value passed through as-is.                      |

The `accept` array on file params filters the file picker by format (e.g. `["json", "bed"]`). Omit to accept any file.

GenomeHub doesn't know or care what the engine does with the file — track, genome, annotation, whatever. That's the engine's problem.

### `GET /api/methods/:id`
Returns the schema for a single method (same shape as an element of the array above). Used by the server to discover parameter types before dispatch.

### `POST /api/methods/:id`
Execute a method. Body keys match parameter names. File params are presigned S3 download URLs. String params are plain values. An additional `_result_upload_url` field contains a presigned S3 upload URL where the engine must PUT the result.

```json
{
  "query": "https://s3.amazonaws.com/bucket/key?X-Amz-...",
  "reference": "https://s3.amazonaws.com/bucket/key?X-Amz-...",
  "name_tag": "feature_type",
  "_result_upload_url": "https://s3.amazonaws.com/bucket/key?X-Amz-..."
}
```

The engine:
1. Downloads input files from the presigned URLs
2. Runs the analysis
3. PUTs the result to `_result_upload_url`
4. Returns `200 OK`

No data flows through GenomeHub. Bytes go directly between S3 and the engine.

## GenomeHub dispatch flow

```
User clicks "Run" in EnginePanel
        │
        ▼
  For each file param:
    Generate presigned S3 download URL
        │
        ▼
  Create result record + presigned S3 upload URL
        │
        ▼
  POST /api/methods/:methodId
    body: {paramName: presignedDownloadUrl, ..., _result_upload_url: presignedUploadUrl}
        │
        ▼
  Engine downloads inputs directly from S3
  Engine runs analysis
  Engine PUTs result directly to S3
  Engine returns 200 OK
        │
        ▼
  Verify result in S3 (HEAD)
  Create provenance edges (result → inputs)
  Return {fileId, filename} to client
```

## Schema reference

See `engine-methods-schema.json` for the formal JSON Schema.
