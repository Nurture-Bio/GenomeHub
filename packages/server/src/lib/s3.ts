/**
 * S3 utilities — wraps AWS SDK v3 for genomic file operations.
 *
 * Uses multipart presigned uploads so the browser streams directly
 * to S3 — the Node server never buffers the payload.
 *
 * @module
 */

import type { Readable } from 'stream';
import {
  S3Client,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  UploadPartCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ─── Client ────────────────────────────────────────────────

export const s3 = new S3Client({
  region: process.env.AWS_REGION ?? 'us-east-1',
  // Credentials picked up from IAM role when running on EC2/ECS.
  // Falls back to env vars AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY for local dev.
});

export const BUCKET = process.env.S3_BUCKET!;

// ─── Multipart initiate ────────────────────────────────────

export async function initiateMultipartUpload(
  s3Key:       string,
  contentType: string,
): Promise<string> {
  const cmd = new CreateMultipartUploadCommand({
    Bucket:      BUCKET,
    Key:         s3Key,
    ContentType: contentType,
    // Server-side encryption — required if bucket policy enforces SSE-S3
    ServerSideEncryption: 'AES256',
  });
  const { UploadId } = await s3.send(cmd);
  if (!UploadId) throw new Error('No UploadId from S3');
  return UploadId;
}

// ─── Part presigned URL ────────────────────────────────────

export async function presignPartUrl(
  s3Key:      string,
  uploadId:   string,
  partNumber: number,
  expiresIn = 3600,
): Promise<string> {
  const cmd = new UploadPartCommand({
    Bucket:     BUCKET,
    Key:        s3Key,
    UploadId:   uploadId,
    PartNumber: partNumber,
  });
  return getSignedUrl(s3, cmd, { expiresIn });
}

// ─── Complete multipart ────────────────────────────────────

export async function completeMultipartUpload(
  s3Key:    string,
  uploadId: string,
  parts:    { PartNumber: number; ETag: string }[],
): Promise<void> {
  const cmd = new CompleteMultipartUploadCommand({
    Bucket:          BUCKET,
    Key:             s3Key,
    UploadId:        uploadId,
    MultipartUpload: {
      Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
    },
  });
  await s3.send(cmd);
}

// ─── Abort ─────────────────────────────────────────────────

export async function abortMultipartUpload(
  s3Key:    string,
  uploadId: string,
): Promise<void> {
  await s3.send(new AbortMultipartUploadCommand({
    Bucket: BUCKET, Key: s3Key, UploadId: uploadId,
  }));
}

// ─── Delete ────────────────────────────────────────────────

export async function deleteObject(s3Key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: s3Key }));
}

// ─── Presigned download URL ────────────────────────────────

export async function presignDownloadUrl(
  s3Key:    string,
  filename: string,
  expiresIn = 3600,
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket:                     BUCKET,
    Key:                        s3Key,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  });
  return getSignedUrl(s3, cmd, { expiresIn });
}

// ─── Head object (verify after upload) ────────────────────

export async function headObject(s3Key: string) {
  return s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: s3Key }));
}

// ─── Fetch first N bytes (for preview) ─────────────────────

export async function fetchS3Head(
  s3Key: string,
  bytes: number,
): Promise<Buffer> {
  const cmd = new GetObjectCommand({
    Bucket: BUCKET,
    Key:    s3Key,
    Range:  `bytes=0-${bytes - 1}`,
  });
  const res = await s3.send(cmd);
  // Body is a Readable stream in Node
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// ─── Fetch arbitrary byte range (for paginated preview) ─────

export async function fetchS3Range(
  s3Key: string,
  startByte: number,
  bytes: number,
): Promise<Buffer> {
  const cmd = new GetObjectCommand({
    Bucket: BUCKET,
    Key:    s3Key,
    Range:  `bytes=${startByte}-${startByte + bytes - 1}`,
  });
  const res = await s3.send(cmd);
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// ─── Get full object ────────────────────────────────────────

export async function getObject(s3Key: string): Promise<Buffer> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: s3Key });
  const res = await s3.send(cmd);
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// ─── Put object (buffered) ──────────────────────────────────

export async function putObject(
  s3Key:       string,
  body:        Buffer,
  contentType: string,
): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket:               BUCKET,
    Key:                  s3Key,
    Body:                 body,
    ContentType:          contentType,
    ServerSideEncryption: 'AES256',
  }));
}

// ─── Put object (streaming) ─────────────────────────────────
// Uses @aws-sdk/lib-storage Upload for streaming multipart.
// Zero materialization in Node heap — the stream is piped
// directly from the caller to S3.

export async function putObjectStream(
  s3Key:       string,
  body:        Readable,
  contentType: string,
): Promise<void> {
  const upload = new Upload({
    client: s3,
    params: {
      Bucket:               BUCKET,
      Key:                  s3Key,
      Body:                 body,
      ContentType:          contentType,
      ServerSideEncryption: 'AES256',
    },
  });
  await upload.done();
}

// ─── S3 key builder ────────────────────────────────────────

export function buildS3Key(fileId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._\-]/g, '_');
  return `files/${fileId}/${safe}`;
}
