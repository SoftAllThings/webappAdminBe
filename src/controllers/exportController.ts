import { Request, Response } from "express";
import archiver from "archiver";
import {
  streamExportZip,
  listDatasets,
  type ExportOptions,
} from "../services/dataExportService";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_KEYS = new Set(listDatasets().map((d) => d.key));

/** Rejects malformed dates AND impossible ones ('2026-13-45' passes a regex). */
function isRealDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const exportController = {
  listDatasets(_req: Request, res: Response): void {
    res.json({ success: true, data: listDatasets() });
  },

  async downloadZip(req: Request, res: Response): Promise<void> {
    const b = req.body as Record<string, unknown>;

    if (!isRealDate(b.from) || !isRealDate(b.to)) {
      res.status(400).json({
        success: false,
        error: { message: "from and to are required, format YYYY-MM-DD" },
      });
      return;
    }
    if (b.from > b.to) {
      res.status(400).json({
        success: false,
        error: { message: "from must be on or before to" },
      });
      return;
    }
    if (
      !Array.isArray(b.datasets) ||
      b.datasets.length === 0 ||
      !b.datasets.every((k) => typeof k === "string" && VALID_KEYS.has(k))
    ) {
      res.status(400).json({
        success: false,
        error: {
          message: `datasets must be a non-empty array of: ${[...VALID_KEYS].join(", ")}`,
        },
      });
      return;
    }

    const opts: ExportOptions = {
      from: b.from,
      to: b.to,
      datasets: b.datasets as string[],
      includeEmails: b.includeEmails === true,
      includeRawPayloads: b.includeRawPayloads === true,
    };

    const filename = `poopcheck-export-${opts.from}_${opts.to}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");

    const archive = archiver("zip", { zlib: { level: 9 } });

    // Headers are already sent once piping starts, so a later failure cannot
    // become a JSON error response — abort the archive and let the client see
    // a truncated download rather than a silently valid-looking one.
    archive.on("warning", (err: Error) => console.warn("[export] archiver:", err));
    archive.on("error", (err: Error) => {
      console.error("[export] archiver failed:", err);
      res.destroy(err);
    });
    // Detect a real client disconnect on the RESPONSE, not the request.
    // req 'close' fires as soon as body-parser has consumed the POST body —
    // long before the zip has finished streaming — so aborting on it kills
    // every export that takes more than a moment.
    // writableFinished is true only after res.end() has fully flushed, so a
    // close without it means the client actually went away.
    res.on("close", () => {
      if (!res.writableFinished) {
        console.warn("[export] client disconnected before completion, aborting");
        archive.abort();
      }
    });

    archive.pipe(res);

    try {
      const results = await streamExportZip(archive, opts);
      await archive.finalize();
      console.log(
        `[export] ${filename} — ${results
          .map((r) => `${r.key}:${r.rows}`)
          .join(" ")}`,
      );
    } catch (err) {
      console.error("[export] failed:", err);
      archive.abort();
      if (!res.headersSent) {
        res
          .status(500)
          .json({ success: false, error: { message: "Export failed" } });
      } else {
        res.destroy();
      }
    }
  },
};
