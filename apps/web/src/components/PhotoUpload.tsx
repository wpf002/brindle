"use client";
import { useRef, useState } from "react";
import { authed, humanizeError } from "../lib/session";

interface PresignResult {
  uploadUrl: string;
  key: string;
  maxBytes: number;
}

/**
 * Uploads straight from the browser to object storage using a short-lived
 * presigned PUT — the bytes never pass through our API. Returns the stored
 * object keys to the parent form.
 */
export function PhotoUpload({ onUploaded, prefix = "lots" }: {
  onUploaded: (keys: string[]) => void;
  prefix?: string;
}) {
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setBusy(true);
    setError("");
    const keys: string[] = [];

    for (const file of files) {
      try {
        const presign = await authed<PresignResult>("/media/presign", {
          method: "POST",
          body: JSON.stringify({ contentType: file.type, contentLength: file.size, prefix }),
        });
        const put = await fetch(presign.uploadUrl, {
          method: "PUT",
          headers: { "content-type": file.type },
          body: file,
        });
        if (!put.ok) throw new Error("UPLOAD_FAILED");
        keys.push(presign.key);
      } catch (err) {
        const raw = err instanceof Error ? err.message : "";
        setError(
          raw.startsWith("FILE_TOO_LARGE")
            ? `${file.name} is too large.`
            : raw.startsWith("UNSUPPORTED_CONTENT_TYPE")
              ? `${file.name} isn't a supported file type.`
              : raw === "S3_BUCKET_NOT_CONFIGURED"
                ? "Photo storage isn't configured on this environment yet."
                : humanizeError(err),
        );
      }
    }

    const next = [...uploaded, ...keys];
    setUploaded(next);
    onUploaded(next);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <label className="field">
      <span className="label">Photos</span>
      <input
        ref={inputRef}
        className="input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={onFiles}
        disabled={busy}
      />
      {busy && <span className="dim" style={{ fontSize: 12.5 }}>Uploading…</span>}
      {uploaded.length > 0 && (
        <span className="dim" style={{ fontSize: 12.5 }}>
          {uploaded.length} photo{uploaded.length === 1 ? "" : "s"} ready
        </span>
      )}
      {error && <span style={{ fontSize: 12.5, color: "var(--danger)" }}>{error}</span>}
    </label>
  );
}
