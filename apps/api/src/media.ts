import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
  prefix?: string; // e.g. "lots", "certs" — namespaces the object key
}

export interface PresignResult {
  uploadUrl: string;
  key: string;
  expiresInSecs: number;
}

export async function presignUpload(input: PresignInput): Promise<PresignResult> {
  if (!ALLOWED.has(input.contentType)) {
    throw new Error(`UNSUPPORTED_CONTENT_TYPE:${input.contentType}`);
  }
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET_NOT_CONFIGURED");

  const prefix = (input.prefix ?? "uploads").replace(/[^a-z0-9/_-]/gi, "");
  const key = `${prefix}/${randomUUID()}`;

  const uploadUrl = await getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: input.contentType }),
    { expiresIn: PRESIGN_TTL_SECS },
  );

  return { uploadUrl, key, expiresInSecs: PRESIGN_TTL_SECS };
}
