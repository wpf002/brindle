import { describe, it, expect } from "vitest";
import { sniffContentType, matchesDeclared, SNIFF_BYTES } from "./magicBytes.js";

/** Build a SNIFF_BYTES-long header from a byte/string spec. */
function header(...parts: (number | string)[]): Uint8Array {
  const bytes: number[] = [];
  for (const p of parts) {
    if (typeof p === "number") bytes.push(p);
    else for (const ch of p) bytes.push(ch.charCodeAt(0));
  }
  const buf = new Uint8Array(SNIFF_BYTES);
  buf.set(bytes.slice(0, SNIFF_BYTES));
  return buf;
}

describe("sniffContentType", () => {
  it("identifies JPEG from the SOI marker", () => {
    expect(sniffContentType(header(0xff, 0xd8, 0xff, 0xe0, "JFIF"))).toBe("image/jpeg");
  });

  it("identifies Exif JPEG (different fourth byte)", () => {
    expect(sniffContentType(header(0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, "Exif"))).toBe("image/jpeg");
  });

  it("identifies PNG from the full 8-byte signature", () => {
    expect(sniffContentType(header(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
  });

  it("identifies WebP from the RIFF form type", () => {
    expect(sniffContentType(header("RIFF", 0x24, 0, 0, 0, "WEBP", "VP8 "))).toBe("image/webp");
  });

  it("identifies PDF", () => {
    expect(sniffContentType(header("%PDF-1.7"))).toBe("application/pdf");
  });

  it("identifies MP4 from the ftyp box", () => {
    expect(sniffContentType(header(0, 0, 0, 0x20, "ftyp", "isom"))).toBe("video/mp4");
  });

  it("identifies QuickTime by its major brand", () => {
    expect(sniffContentType(header(0, 0, 0, 0x14, "ftyp", "qt  "))).toBe("video/quicktime");
  });

  it("treats other ISO-BMFF brands as MP4", () => {
    expect(sniffContentType(header(0, 0, 0, 0x18, "ftyp", "mp42"))).toBe("video/mp4");
    expect(sniffContentType(header(0, 0, 0, 0x18, "ftyp", "M4V "))).toBe("video/mp4");
  });

  // The whole point: things that are NOT media must not sneak through.
  it("rejects HTML dressed up as an upload", () => {
    expect(sniffContentType(header("<!DOCTYPE html><html>"))).toBeNull();
  });

  it("rejects a shell script", () => {
    expect(sniffContentType(header("#!/bin/sh\nrm -rf /"))).toBeNull();
  });

  it("rejects SVG (XML that browsers execute script from)", () => {
    expect(sniffContentType(header("<svg xmlns=\"http:"))).toBeNull();
  });

  it("rejects a Windows executable", () => {
    expect(sniffContentType(header("MZ", 0x90, 0x00))).toBeNull();
  });

  it("rejects a bare RIFF container that isn't WebP (e.g. a WAV)", () => {
    expect(sniffContentType(header("RIFF", 0x24, 0, 0, 0, "WAVE"))).toBeNull();
  });

  it("rejects an empty or truncated header rather than guessing", () => {
    expect(sniffContentType(new Uint8Array(0))).toBeNull();
    expect(sniffContentType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("matchesDeclared", () => {
  it("accepts an exact match", () => {
    expect(matchesDeclared("image/png", "image/png")).toBe(true);
  });

  it("rejects a PNG declared as a PDF", () => {
    expect(matchesDeclared("image/png", "application/pdf")).toBe(false);
  });

  it("rejects a JPEG declared as a video", () => {
    expect(matchesDeclared("image/jpeg", "video/mp4")).toBe(false);
  });

  // Brands are inconsistent in the wild; same container either way.
  it("lets MP4 and QuickTime stand in for each other", () => {
    expect(matchesDeclared("video/mp4", "video/quicktime")).toBe(true);
    expect(matchesDeclared("video/quicktime", "video/mp4")).toBe(true);
  });

  it("does not extend that leniency to images", () => {
    expect(matchesDeclared("image/jpeg", "image/png")).toBe(false);
  });
});
