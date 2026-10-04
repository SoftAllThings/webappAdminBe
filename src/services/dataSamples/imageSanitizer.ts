import sharp from "sharp";

/**
 * Removes identifying metadata from a photo before it leaves the company.
 *
 * Phone JPEGs carry EXIF (device model, capture time, sometimes GPS), XMP,
 * IPTC, and on newer iPhones an MPF index plus secondary images appended after
 * the primary one. All of that goes.
 *
 * The app already bakes rotation into the pixels (every sampled photo has
 * EXIF orientation 1 or none), so the common path is LOSSLESS: drop the
 * metadata segments and copy the compressed scan data byte-for-byte. Buyers
 * training models care about re-compression artifacts. Only photos that would
 * display rotated without their EXIF orientation, and non-JPEGs, go through
 * sharp, which re-encodes and writes no metadata.
 */

export interface SanitizedImage {
  bytes: Buffer;
  ext: "jpg" | "png";
  method: "stripped" | "reencoded";
}

const ICC_SIGNATURE = Buffer.from("ICC_PROFILE\0", "latin1");
const ADOBE_SIGNATURE = Buffer.from("Adobe", "latin1");
const EXIF_SIGNATURE = Buffer.from("Exif\0\0", "latin1");

const isPng = (b: Buffer) =>
  b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a;

/** EXIF Orientation (tag 0x0112 in IFD0), or null when absent/unreadable. */
function readOrientation(app1Payload: Buffer): number | null {
  if (!app1Payload.subarray(0, 6).equals(EXIF_SIGNATURE)) return null;
  const tiff = app1Payload.subarray(6);
  if (tiff.length < 8) return null;
  const le = tiff.toString("latin1", 0, 2) === "II";
  const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  try {
    const ifd = u32(4);
    const count = u16(ifd);
    for (let k = 0; k < count; k++) {
      const entry = ifd + 2 + 12 * k;
      if (u16(entry) === 0x0112) return u16(entry + 8);
    }
  } catch {
    // RangeError on a truncated IFD: treat as no orientation.
  }
  return null;
}

/**
 * Index of the primary image's EOI marker, scanning from just after the first
 * SOS header. Skips stuffed bytes (FF00), restart markers, and the segments a
 * progressive JPEG puts between scans (DHT, DQT, SOS…).
 */
function findEoi(buf: Buffer, start: number): number {
  let i = start;
  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const m = buf[i + 1]!;
    if (m === 0xff) {
      i++; // fill byte
    } else if (m === 0x00 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
    } else if (m === 0xd9) {
      return i;
    } else {
      if (i + 4 > buf.length) return -1;
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return -1;
}

/**
 * Rebuilds a JPEG keeping only what decoding needs (JFIF, ICC profile, Adobe
 * colour transform, tables, frame and scan data). Returns null when the file
 * is not a well-formed baseline/progressive JPEG — the caller re-encodes it.
 */
export function stripJpegMetadata(
  buf: Buffer,
): { bytes: Buffer; orientation: number | null } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;

  const keep: Buffer[] = [buf.subarray(0, 2)];
  let orientation: number | null = null;
  let i = 2;

  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1]!;
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd9) return null; // EOI before any scan
    const segEnd = i + 2 + buf.readUInt16BE(i + 2);
    if (segEnd > buf.length) return null;

    if (marker === 0xda) {
      // Scan data to the primary EOI. Anything after it (MPF secondary
      // images, gain maps, thumbnails) is dropped.
      const eoi = findEoi(buf, segEnd);
      if (eoi < 0) return null;
      keep.push(buf.subarray(i, eoi + 2));
      return { bytes: Buffer.concat(keep), orientation };
    }

    const payload = buf.subarray(i + 4, segEnd);
    const isAppOrComment = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    const keepSegment =
      !isAppOrComment ||
      marker === 0xe0 || // JFIF
      (marker === 0xe2 && payload.subarray(0, ICC_SIGNATURE.length).equals(ICC_SIGNATURE)) ||
      (marker === 0xee && payload.subarray(0, ADOBE_SIGNATURE.length).equals(ADOBE_SIGNATURE));

    if (marker === 0xe1) orientation = readOrientation(payload) ?? orientation;
    if (keepSegment) keep.push(buf.subarray(i, segEnd));
    i = segEnd;
  }
  return null;
}

/** Orientations 2–8 change how the pixels display; 1, absent, and the
 *  out-of-spec 0 some Android encoders write all mean "as stored". */
const needsRotation = (o: number | null) => o !== null && o >= 2 && o <= 8;

export async function sanitizeImage(input: Buffer): Promise<SanitizedImage> {
  const stripped = stripJpegMetadata(input);
  if (stripped && !needsRotation(stripped.orientation)) {
    return { bytes: stripped.bytes, ext: "jpg", method: "stripped" };
  }

  // sharp writes no metadata unless asked to; rotate() bakes in EXIF orientation.
  if (isPng(input)) {
    const bytes = await sharp(input).rotate().png().toBuffer();
    return { bytes, ext: "png", method: "reencoded" };
  }
  const bytes = await sharp(input).rotate().jpeg({ quality: 92 }).toBuffer();
  return { bytes, ext: "jpg", method: "reencoded" };
}
