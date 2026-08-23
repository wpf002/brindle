import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { sniffContentType, matchesDeclared, SNIFF_BYTES } from "./magicBytes.js";

// Media (lot photos/videos, disease-test certs) is uploaded straight from the
// browser to object storage via a presigned PUT — bytes never touch the API.
// Works with S3 or Cloudflare R2 (S3-compatible); R2 just needs S3_ENDPOINT set.

const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "application/pdf",
]);

const PRESIGN_TTL_SECS = 300;

// Cap what a presigned URL can be used to upload. Without this a valid URL is
// a blank cheque against the bucket — the signature says nothing about size.
// ContentLength is signed into the URL, so the storage provider rejects any PUT
// whose body doesn't match exactly.
const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB
const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB

function maxBytesFor(contentType: string): number {
  if (contentType.startsWith("video/")) return MAX_VIDEO_BYTES;
  if (contentType === "application/pdf") return MAX_DOC_BYTES;
  return MAX_IMAGE_BYTES;
}

let client: S3Client | null = null;
function s3(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: process.env.S3_REGION ?? "auto",
    endpoint: process.env.S3_ENDPOINT || undefined, // set for R2; omit for AWS S3
    forcePathStyle: Boolean(process.env.S3_ENDPOINT), // R2 wants path-style
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
  return client;
}

export interface PresignInput {
  contentType: string;
  contentLength: number; // exact byte size of the file being uploaded
  prefix?: string; // e.g. "lots", "certs" — namespaces the object key
}

export interface PresignResult {
  uploadUrl: string;
  key: string;
  expiresInSecs: number;
  maxBytes: number;
}

export async function presignUpload(input: PresignInput): Promise<PresignResult> {
  if (!ALLOWED.has(input.contentType)) {
    throw new Error(`UNSUPPORTED_CONTENT_TYPE:${input.contentType}`);
  }
  const maxBytes = maxBytesFor(input.contentType);
  if (!Number.isFinite(input.contentLength) || input.contentLength <= 0) {
    throw new Error("CONTENT_LENGTH_REQUIRED");
  }
  if (input.contentLength > maxBytes) {
    throw new Error(`FILE_TOO_LARGE:${maxBytes}`);
  }

  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET_NOT_CONFIGURED");

  const prefix = (input.prefix ?? "uploads").replace(/[^a-z0-9/_-]/gi, "");
  const key = `${prefix}/${randomUUID()}`;

  const uploadUrl = await getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    }),
    { expiresIn: PRESIGN_TTL_SECS },
  );

  return { uploadUrl, key, expiresInSecs: PRESIGN_TTL_SECS, maxBytes };
}

export interface VerifyResult {
  key: string;
  contentType: SniffedTypeOrNull;
  ok: boolean;
}
type SniffedTypeOrNull = ReturnType<typeof sniffContentType>;

/**
 * Confirm an uploaded object is what it claimed to be.
 *
 * The presigned URL signs the declared content type and size, but not the
 * bytes — so a client can perfectly legally PUT an HTML page under
 * `image/jpeg`. We read only the first {@link SNIFF_BYTES} back with a ranged
 * GET (cheap even for a 500 MB video) and check the file signature. A mismatch
 * deletes the object: leaving it in the bucket means it stays reachable at a
 * URL we hand out.
 *
 * Callers must treat an unverified key as unusable — nothing should be attached
 * to a lot until this passes.
 */
export async function verifyUpload(key: string, declaredContentType: string): Promise<VerifyResult> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET_NOT_CONFIGURED");
  if (!ALLOWED.has(declaredContentType)) {
    throw new Error(`UNSUPPORTED_CONTENT_TYPE:${declaredContentType}`);
  }

  let head: Uint8Array;
  try {
    const res = await s3().send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${SNIFF_BYTES - 1}` }),
    );
    head = await res.Body!.transformToByteArray();
  } catch {
    throw new Error("OBJECT_NOT_FOUND");
  }

  const sniffed = sniffContentType(head);
  const ok = sniffed != null && matchesDeclared(sniffed, declaredContentType);

  if (!ok) {
    // Best-effort cleanup — a failed delete shouldn't turn a rejection into a
    // 500, but the key is still refused either way.
    await s3()
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
      .catch(() => undefined);
  }

  return { key, contentType: sniffed, ok };
}
