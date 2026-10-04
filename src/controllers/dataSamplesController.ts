import { createHash } from "crypto";
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import admin from "firebase-admin";
import "../config/firebase";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { publicCatalog, SOURCES, getField, type OptionKey, type SourceKey } from "../services/dataSamples/catalog";
import {
  DEFAULT_OPTIONS,
  MAX_SAMPLES_PER_EXPORT,
  getAvailability,
  prepareExport,
  previewRecord,
  streamExportZip,
  toFilters,
  type ExportConfig,
} from "../services/dataSamples/exportService";
import {
  createBuyer,
  findDeliveriesForPerson,
  getDownloadBundle,
  getExport,
  listBuyers,
  listExports,
  voidExport,
} from "../repositories/dataSamples.repository";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_KEYS = new Set<string>(SOURCES.map((s) => s.key));
const OPTION_KEYS = Object.keys(DEFAULT_OPTIONS) as OptionKey[];
const DOWNLOAD_AUDIENCE = "data-sample-download";
const DOWNLOAD_TTL_SECONDS = 15 * 60;

/**
 * Downloads are plain browser navigations (so multi-GB zips stream to disk
 * instead of into memory), which means the token rides in the URL and ends up
 * in access logs. Sign it with a key derived from JWT_SECRET so it can never
 * double as an admin bearer token, and keep it short-lived and single-export.
 */
function downloadKey(): Buffer {
  return createHash("sha256").update(`${process.env.JWT_SECRET}:${DOWNLOAD_AUDIENCE}`).digest();
}

function fail(res: Response, status: number, message: string, hint?: string): void {
  res.status(status).json({ success: false, error: { message, hint } });
}

function handleError(res: Response, err: unknown, where: string): void {
  console.error(`[data-samples/${where}] error:`, err);
  const code = (err as { code?: string } | null)?.code;
  if (code === "42P01" || code === "3F000") {
    return fail(
      res,
      503,
      "The data-samples tables don't exist yet",
      "Run migrations/008_create_data_samples.sql (npm run migrate-008)",
    );
  }
  fail(res, 500, err instanceof Error ? err.message : "Unknown error");
}

function parseBuyerId(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseOptions(raw: unknown): Record<OptionKey, boolean> {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_OPTIONS };
  for (const k of OPTION_KEYS) {
    const v = src[k];
    if (typeof v === "boolean") out[k] = v;
    else if (v === "true" || v === "false") out[k] = v === "true";
  }
  return out;
}

export const dataSamplesController = {
  /** GET /api/data-samples/catalog — sources, field groups, fields, Bristol types. */
  catalog(_req: Request, res: Response): void {
    res.json({
      success: true,
      data: { ...publicCatalog(), defaultOptions: DEFAULT_OPTIONS, maxSamplesPerExport: MAX_SAMPLES_PER_EXPORT },
    });
  },

  /** GET /api/data-samples/availability?source=…&buyerId=…&<option>=true|false */
  async availability(req: Request, res: Response): Promise<void> {
    const source = String(req.query.source ?? "");
    if (!SOURCE_KEYS.has(source)) return fail(res, 400, "Unknown source");
    const buyerId = req.query.buyerId ? parseBuyerId(req.query.buyerId) : null;
    if (req.query.buyerId && buyerId === null) return fail(res, 400, "Invalid buyerId");
    try {
      const data = await getAvailability(
        toFilters(source as SourceKey, buyerId, parseOptions(req.query)),
      );
      res.json({ success: true, data });
    } catch (err) {
      handleError(res, err, "availability");
    }
  },

  /** GET /api/data-samples/preview?source=…&<option>=… — one real record, every field of the source. */
  async preview(req: Request, res: Response): Promise<void> {
    const source = String(req.query.source ?? "");
    if (!SOURCE_KEYS.has(source)) return fail(res, 400, "Unknown source");
    try {
      const record = await previewRecord(toFilters(source as SourceKey, null, parseOptions(req.query)));
      if (!record) return fail(res, 404, "No photos match these filters");
      res.json({ success: true, data: { record } });
    } catch (err) {
      handleError(res, err, "preview");
    }
  },

  /** GET /api/data-samples/buyers */
  async listBuyers(_req: Request, res: Response): Promise<void> {
    try {
      res.json({ success: true, data: await listBuyers() });
    } catch (err) {
      handleError(res, err, "listBuyers");
    }
  },

  /** POST /api/data-samples/buyers { name, notes? } */
  async createBuyer(req: Request, res: Response): Promise<void> {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const notes = typeof req.body?.notes === "string" && req.body.notes.trim() ? req.body.notes.trim() : null;
    if (!name || name.length > 200) return fail(res, 400, "Buyer name is required (max 200 characters)");
    try {
      res.status(201).json({ success: true, data: await createBuyer(name, notes) });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        return fail(res, 409, `A buyer called '${name}' already exists`);
      }
      handleError(res, err, "createBuyer");
    }
  },

  /** GET /api/data-samples/buyers/:buyerId/exports */
  async listExports(req: Request, res: Response): Promise<void> {
    const buyerId = parseBuyerId(req.params.buyerId);
    if (buyerId === null) return fail(res, 400, "Invalid buyerId");
    try {
      res.json({ success: true, data: await listExports(buyerId) });
    } catch (err) {
      handleError(res, err, "listExports");
    }
  },

  /** POST /api/data-samples/exports { buyerId, source, counts, fields, options } */
  async prepare(req: Request, res: Response): Promise<void> {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const buyerId = parseBuyerId(b.buyerId);
    if (buyerId === null) return fail(res, 400, "Pick a buyer first");
    if (typeof b.source !== "string" || !SOURCE_KEYS.has(b.source)) return fail(res, 400, "Unknown source");
    const source = b.source as SourceKey;

    const rawCounts = (b.counts && typeof b.counts === "object" ? b.counts : {}) as Record<string, unknown>;
    const counts: Record<string, number> = {};
    for (let t = 1; t <= 7; t++) {
      const v = rawCounts[String(t)] ?? 0;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        return fail(res, 400, `Count for Type ${t} must be a whole number ≥ 0`);
      }
      counts[String(t)] = v;
    }
    const total = Object.values(counts).reduce((a, n) => a + n, 0);
    if (total === 0) return fail(res, 400, "Ask for at least one photo");
    if (total > MAX_SAMPLES_PER_EXPORT) {
      return fail(res, 400, `At most ${MAX_SAMPLES_PER_EXPORT.toLocaleString("en-US")} photos per export`);
    }

    if (!Array.isArray(b.fields) || !b.fields.every((f) => typeof f === "string")) {
      return fail(res, 400, "fields must be a list of field ids");
    }
    const invalid = (b.fields as string[]).filter((id) => !getField(id)?.sources.includes(source));
    if (invalid.length > 0) {
      return fail(res, 400, `Not available for this source: ${invalid.join(", ")}`);
    }

    const config: ExportConfig = {
      source,
      counts,
      fields: [...new Set(b.fields as string[])],
      options: parseOptions(b.options),
    };
    const createdBy = (req as AuthenticatedRequest).user?.username ?? null;

    try {
      const result = await prepareExport(buyerId, config, createdBy);
      if ("error" in result) {
        return result.error === "buyer_not_found"
          ? fail(res, 404, "Buyer not found")
          : fail(res, 409, "No photos match these settings — everything eligible may already have been sent to this buyer");
      }
      res.status(201).json({ success: true, data: result.export });
    } catch (err) {
      handleError(res, err, "prepare");
    }
  },

  /** POST /api/data-samples/exports/:exportId/download-token */
  async downloadToken(req: Request, res: Response): Promise<void> {
    const exportId = String(req.params.exportId ?? "");
    if (!UUID_RE.test(exportId)) return fail(res, 400, "Invalid export id");
    try {
      const exp = await getExport(exportId);
      if (!exp) return fail(res, 404, "Export not found");
      if (exp.status === "voided") return fail(res, 409, "This export was voided");
      const token = jwt.sign({ exportId }, downloadKey(), {
        audience: DOWNLOAD_AUDIENCE,
        expiresIn: DOWNLOAD_TTL_SECONDS,
      });
      res.json({
        success: true,
        data: { path: `/data-samples/exports/${exportId}/download?token=${encodeURIComponent(token)}` },
      });
    } catch (err) {
      handleError(res, err, "downloadToken");
    }
  },

  /** GET /api/data-samples/exports/:exportId/download?token=… — streams the zip. */
  async download(req: Request, res: Response): Promise<void> {
    const exportId = String(req.params.exportId ?? "");
    let claims: { exportId?: unknown };
    try {
      claims = jwt.verify(String(req.query.token ?? ""), downloadKey(), {
        audience: DOWNLOAD_AUDIENCE,
      }) as { exportId?: unknown };
    } catch {
      return fail(res, 401, "Download link expired — start the download again from the Data Samples tab");
    }
    if (claims.exportId !== exportId) return fail(res, 403, "Token is for a different export");

    try {
      const bundle = await getDownloadBundle(exportId);
      if (!bundle) return fail(res, 404, "Export not found");
      if (bundle.export.status === "voided") return fail(res, 409, "This export was voided");
      await streamExportZip(bundle, res);
    } catch (err) {
      console.error("[data-samples/download] failed:", err);
      if (!res.headersSent) handleError(res, err, "download");
      else res.destroy(); // a truncated zip, not a valid-looking partial one
    }
  },

  /** POST /api/data-samples/exports/:exportId/void — frees its photos for future exports. */
  async void(req: Request, res: Response): Promise<void> {
    const exportId = String(req.params.exportId ?? "");
    if (!UUID_RE.test(exportId)) return fail(res, 400, "Invalid export id");
    try {
      const exp = await voidExport(exportId);
      if (!exp) return fail(res, 404, "Export not found or already voided");
      res.json({ success: true, data: exp });
    } catch (err) {
      handleError(res, err, "void");
    }
  },

  /** GET /api/data-samples/lookup?q=<firebase uid or email> — which buyers got this person's photos. */
  async lookup(req: Request, res: Response): Promise<void> {
    const q = String(req.query.q ?? "").trim();
    if (!q || q.length > 320) return fail(res, 400, "Enter a user id or email");
    try {
      let uid = q;
      if (q.includes("@")) {
        try {
          uid = (await admin.auth().getUserByEmail(q)).uid;
        } catch {
          return fail(res, 404, `No PoopCheck account with email ${q}`);
        }
      }
      res.json({ success: true, data: { uid, deliveries: await findDeliveriesForPerson(uid) } });
    } catch (err) {
      handleError(res, err, "lookup");
    }
  },
};
