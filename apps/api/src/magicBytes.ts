// Content-type sniffing from file signatures.
//
// A presigned PUT signs the *declared* content type and length, not the bytes.
// Nothing stops someone from declaring `image/jpeg` and uploading an HTML page
// or a script — which then gets served back from our bucket under a type the
// browser trusts. So after upload we read the leading bytes of the stored
// object and confirm they actually are what the uploader claimed.

/** The container formats we accept, keyed by the MIME type clients declare. */
export type SniffedType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "video/mp4"
  | "video/quicktime"
  | "application/pdf";

/** Enough bytes for every signature below, including the ISO-BMFF ftyp box. */
export const SNIFF_BYTES = 32;

function startsWith(buf: Uint8Array, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  return sig.every((b, i) => buf[offset + i] === b);
}

function ascii(buf: Uint8Array, offset: number, len: number): string {
  if (buf.length < offset + len) return "";
  return String.fromCharCode(...buf.subarray(offset, offset + len));
}

/**
 * Identify the leading bytes, or null if they match nothing we accept.
 * Deliberately allowlist-only: an unrecognised signature is a rejection, not a
 * pass-through.
 */
export function sniffContentType(bytes: Uint8Array): SniffedType | null {
  // JPEG: SOI marker. Every variant (JFIF, Exif, raw) starts with these three.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";

  // PNG: the 8-byte signature, chosen to survive text-mode mangling.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";

  // WebP: RIFF container with a "WEBP" form type at offset 8.
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";

  // PDF: "%PDF-" header.
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";

  // ISO base media (MP4 / QuickTime): a "ftyp" box at offset 4, with the major
  // brand at offset 8 telling the two apart. "qt  " is QuickTime; everything
  // else in the family (isom, mp42, avc1, M4V…) we treat as MP4.
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }

  return null;
}

/**
 * Does the sniffed type satisfy what the uploader declared?
 *
 * Exact match, with one exception: MP4 and QuickTime share the ISO-BMFF
 * container and brands are inconsistent in the wild (phone video declared as
 * one is routinely stamped the other), so either satisfies either. They're the
 * same container either way — nothing is smuggled by the swap.
 */
export function matchesDeclared(sniffed: SniffedType, declared: string): boolean {
  if (sniffed === declared) return true;
  const isoBmff = new Set(["video/mp4", "video/quicktime"]);
  return isoBmff.has(sniffed) && isoBmff.has(declared);
}
