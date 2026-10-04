import { createHmac, randomBytes } from "crypto";
import type { Response } from "express";
import archiver, { type Archiver } from "archiver";
import { fetchObjectBytes, SOFTAI_BUCKET } from "../s3Service";
import { sanitizeImage, type SanitizedImage } from "./imageSanitizer";
import { buildReadme } from "./readme";
import {
  FIELDS,
  SOURCES,
  sourceTable,
  type FieldDef,
  type OptionKey,
  type SourceKey,
} from "./catalog";
import {
  countAvailable,
  createExport,
  fetchRows,
  formatSampleId,
  pickRandomCandidate,
  recordDelivery,
  type DownloadBundle,
  type ExportItem,
  type SampleFilters,
} from "../../repositories/dataSamples.repository";

export const MAX_SAMPLES_PER_EXPORT = 25_000;

export interface ExportConfig {
  source: SourceKey;
  /** Bristol type ("1".."7") → number of photos wanted. */
  counts: Record<string, number>;
  fields: string[];
  options: Record<OptionKey, boolean>;
}

export const DEFAULT_OPTIONS: Record<OptionKey, boolean> = {
  excludeSentToBuyer: true,
  excludeSentToAnyBuyer: false,
  includeRejected: false,
  includeWebDemo: false,
  includeMinors: false,
};

export function toFilters(
  source: SourceKey,
  buyerId: number | null,
  options: Record<OptionKey, boolean>,
): SampleFilters {
  return {
    source,
    buyerId,
    excludeSentToBuyer: options.excludeSentToBuyer,
    excludeSentToAnyBuyer: options.excludeSentToAnyBuyer,
    // Source-specific toggles only mean something for their own source.
    includeRejected: source === "app_poop" && options.includeRejected,
    includeWebDemo: source === "stool_logs" && options.includeWebDemo,
    includeMinors: options.includeMinors,
  };
}

export async function getAvailability(filters: SampleFilters) {
  const counts = await countAvailable(filters);
  const perType = [1, 2, 3, 4, 5, 6, 7].map((type) => ({ type, available: counts.get(type) ?? 0 }));
  return { perType, total: perType.reduce((s, t) => s + t.available, 0) };
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

export async function prepareExport(buyerId: number, config: ExportConfig, createdBy: string | null) {
  const quotas = new Map<number, number>();
  for (let t = 1; t <= 7; t++) {
    const n = config.counts[String(t)] ?? 0;
    if (n > 0) quotas.set(t, n);
  }
  const requested = [...quotas.values()].reduce((a, b) => a + b, 0);
  return createExport(
    { buyerId, source: config.source, config: { ...config }, requested, createdBy },
    toFilters(config.source, buyerId, config.options),
    quotas,
    shuffle,
  );
}

// -------------------------------------------------------------- zip stream

const FETCH_CONCURRENCY = 6;
const REENCODE_CONCURRENCY = 2; // sharp holds a decoded 12MP photo (~36MB) per job
const MAX_PENDING_ENTRIES = 8;
const ROW_BATCH = 200;
const S3_TIMEOUT_MS = 60_000;

/** Per-buyer pseudonym: same person → same ID for this buyer, unlinkable across buyers. */
function pseudonymizer(key: Buffer) {
  const cache = new Map<string, string>();
  return (ref: string | null): string | null => {
    if (!ref) return null;
    let id = cache.get(ref);
    if (!id) {
      id = `u_${createHmac("sha256", key).update(ref).digest("hex").slice(0, 12)}`;
      cache.set(ref, id);
    }
    return id;
  };
}

class Semaphore {
  private waiting: Array<() => void> = [];
  constructor(private free: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free--;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.free++;
    }
  }
}

/**
 * archive.append() only queues; without a bound, a fast S3 and a slow client
 * would buffer the whole export in memory. Waits until archiver has written
 * an entry before queueing more — and archiver itself stalls while the
 * response is backpressured, so memory stays at a handful of photos.
 */
class ThrottledArchive {
  private pending = 0;
  private closed = false;
  private waiters: Array<() => void> = [];
  constructor(private readonly archive: Archiver) {
    archive.on("entry", () => {
      this.pending--;
      this.waiters.shift()?.();
    });
  }
  async append(data: Buffer | string, entry: archiver.ZipEntryData) {
    while (this.pending >= MAX_PENDING_ENTRIES && !this.closed) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    if (this.closed) return;
    this.pending++;
    this.archive.append(data, entry);
  }
  /** Unblock everything on abort so the producer loop can exit. */
  release() {
    this.closed = true;
    this.waiters.splice(0).forEach((w) => w());
  }
}

type Outcome<T> = { ok: true; item: ExportItem; value: T } | { ok: false; item: ExportItem; error: unknown };

/** Runs `fn` with bounded concurrency but yields results in input order. */
async function* mapOrdered<T>(
  items: ExportItem[],
  concurrency: number,
  fn: (item: ExportItem) => Promise<T>,
): AsyncGenerator<Outcome<T>> {
  const inflight: Array<Promise<Outcome<T>>> = [];
  let next = 0;
  const launch = () => {
    const item = items[next++]!;
    inflight.push(
      fn(item).then(
        (value): Outcome<T> => ({ ok: true, item, value }),
        (error): Outcome<T> => ({ ok: false, item, error }),
      ),
    );
  };
  while (next < items.length && inflight.length < concurrency) launch();
  while (inflight.length > 0) {
    const outcome = await inflight.shift()!;
    if (next < items.length) launch();
    yield outcome;
  }
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "buyer"
  );
}

export function exportFolderName(bundle: DownloadBundle): string {
  const day = new Date(bundle.export.created_at).toISOString().slice(0, 10);
  return `${slug(bundle.buyer.name)}_${day}_${bundle.items.length}-samples`;
}

export function selectedFields(source: SourceKey, ids: unknown): FieldDef[] {
  const wanted = new Set(Array.isArray(ids) ? ids : []);
  // Catalog order, not request order, so every delivery's JSON has the same shape.
  return FIELDS.filter((f) => wanted.has(f.id) && f.sources.includes(source));
}

function buildRecord(
  item: ExportItem,
  imagePath: string,
  row: Record<string, unknown>,
  fields: FieldDef[],
  pseudonymize: (ref: string | null) => string | null,
): Record<string, unknown> {
  const record: Record<string, unknown> = { sample_id: item.sample_id, image: imagePath };
  for (const f of fields) {
    const group = (record[f.group] ??= {}) as Record<string, unknown>;
    group[f.name] = f.extract(row, { pseudonymize });
  }
  return record;
}

/**
 * A real record for the dashboard's live JSON preview: one random eligible
 * photo with every field its source offers (the UI filters to the ticked
 * ones). Built by the same extractors as the zip, so the preview cannot drift
 * from what the buyer receives. The user id uses a throwaway key — it is not
 * any buyer's real pseudonym.
 */
export async function previewRecord(filters: SampleFilters): Promise<Record<string, unknown> | null> {
  const pick = await pickRandomCandidate(filters);
  if (!pick) return null;
  const rows = await fetchRows(sourceTable(filters.source), [pick.row_id], true);
  const row = rows.get(pick.row_id);
  if (!row) return null;
  const item: ExportItem = {
    seq: 1,
    sample_id: formatSampleId(1),
    source_row_id: pick.row_id,
    person_ref: pick.person_ref,
    bristol_type: pick.bristol,
  };
  const fields = FIELDS.filter((f) => f.sources.includes(filters.source));
  return buildRecord(item, `images/${item.sample_id}.jpg`, row, fields, pseudonymizer(randomBytes(32)));
}

/**
 * Streams `<folder>/images/*`, `metadata.json` and `README.md` as a zip to
 * `res`. Records the delivery only once the client has received every byte.
 */
export async function streamExportZip(bundle: DownloadBundle, res: Response): Promise<void> {
  const source = SOURCES.find((s) => s.key === bundle.export.source);
  if (!source) throw new Error(`Unknown source '${bundle.export.source}'`);
  const fields = selectedFields(source.key, bundle.export.config.fields);
  const table = sourceTable(source.key);
  const bucket = table === "softai.stool_logs" ? SOFTAI_BUCKET : undefined;
  const withVotes = fields.some((f) => f.group === "model_votes");
  const pseudonymize = pseudonymizer(bundle.buyer.pseudonym_key);
  const folder = exportFolderName(bundle);

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${folder}.zip"`);
  res.setHeader("Cache-Control", "no-store");

  const archive = archiver("zip", { zlib: { level: 6 }, forceZip64: false });
  const writer = new ThrottledArchive(archive);
  let aborted = false;

  archive.on("warning", (err: Error) => console.warn("[data-samples] archiver:", err));
  archive.on("error", (err: Error) => {
    console.error("[data-samples] archiver failed:", err);
    aborted = true;
    writer.release();
    res.destroy(err);
  });
  // A 'close' before the response finished means the client went away.
  res.on("close", () => {
    if (!res.writableFinished) {
      aborted = true;
      writer.release();
      archive.abort();
    }
  });
  archive.pipe(res);

  const reencodes = new Semaphore(REENCODE_CONCURRENCY);
  const records: Array<Record<string, unknown>> = [];
  const failedSeqs: number[] = [];
  const perType = new Map<number, number>();
  const formats = { jpg: 0, png: 0 };
  let reencoded = 0;
  const started = Date.now();

  for (let offset = 0; offset < bundle.items.length && !aborted; offset += ROW_BATCH) {
    const batch = bundle.items.slice(offset, offset + ROW_BATCH);
    const rows = await fetchRows(table, batch.map((i) => i.source_row_id), withVotes);

    const work = mapOrdered(batch, FETCH_CONCURRENCY, async (item) => {
      const row = rows.get(item.source_row_id);
      // Row gone (e.g. the user deleted their account since the export was prepared).
      if (!row) throw new Error("source row no longer exists");
      const key = typeof row.image_key === "string" ? row.image_key : null;
      if (!key) throw new Error("no image key");
      const { body } = await fetchObjectBytes(key, {
        ...(bucket ? { bucket } : {}),
        abortSignal: AbortSignal.timeout(S3_TIMEOUT_MS),
      });
      const image: SanitizedImage = await reencodes.run(() => sanitizeImage(body));
      return { row, image };
    });

    for await (const outcome of work) {
      if (aborted) break;
      if (!outcome.ok) {
        failedSeqs.push(outcome.item.seq);
        console.warn(
          `[data-samples] ${outcome.item.sample_id} skipped:`,
          outcome.error instanceof Error ? outcome.error.message : outcome.error,
        );
        continue;
      }
      const { item } = outcome;
      const { row, image } = outcome.value;
      const imagePath = `images/${item.sample_id}.${image.ext}`;
      // JPEG/PNG are already compressed; deflating them again only burns CPU.
      await writer.append(image.bytes, { name: `${folder}/${imagePath}`, store: true });
      records.push(buildRecord(item, imagePath, row, fields, pseudonymize));
      perType.set(item.bristol_type, (perType.get(item.bristol_type) ?? 0) + 1);
      formats[image.ext]++;
      if (image.method === "reencoded") reencoded++;
    }

    console.log(
      `[data-samples] ${bundle.export.id}: ${Math.min(offset + ROW_BATCH, bundle.items.length)}/${bundle.items.length} processed (${failedSeqs.length} skipped, ${Math.round((Date.now() - started) / 1000)}s)`,
    );
  }

  if (aborted) {
    console.warn(`[data-samples] ${bundle.export.id}: download aborted by client`);
    return;
  }

  await writer.append(JSON.stringify(records, null, 2) + "\n", { name: `${folder}/metadata.json` });
  await writer.append(
    buildReadme({
      buyerName: bundle.buyer.name,
      source,
      fields,
      records,
      perType,
      formats,
      reencoded,
      generatedAt: new Date(),
    }),
    { name: `${folder}/README.md` },
  );

  const finished = new Promise<boolean>((resolve) => {
    res.once("finish", () => resolve(true));
    res.once("close", () => resolve(res.writableFinished));
  });
  // finalize() never settles if the client vanishes mid-way; the response does.
  await Promise.race([archive.finalize(), finished]);
  if (!(await finished)) return;

  await recordDelivery(bundle.export.id, records.length, failedSeqs).catch((err) =>
    // The buyer has the file; failing to stamp it must not look like a failed download.
    console.error(`[data-samples] ${bundle.export.id}: delivered but not recorded:`, err),
  );
  console.log(
    `[data-samples] ${bundle.export.id}: delivered ${records.length} photos (${failedSeqs.length} skipped, ${reencoded} re-encoded) in ${Math.round((Date.now() - started) / 1000)}s`,
  );
}
