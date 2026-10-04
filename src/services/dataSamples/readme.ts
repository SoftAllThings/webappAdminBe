import { BRISTOL_DESCRIPTIONS, GROUPS, type FieldDef, type SourceDef } from "./catalog";

/**
 * The buyer-facing README that ships inside every zip. Written for someone
 * who has never seen our systems: no table names, every field explained, and
 * the provenance of the labels stated plainly — a buyer who assumes AI labels
 * are ground truth is a buyer with a grievance.
 */

export interface ReadmeInput {
  buyerName: string;
  source: SourceDef;
  fields: FieldDef[];
  records: Array<Record<string, unknown>>;
  perType: Map<number, number>;
  formats: { jpg: number; png: number };
  reencoded: number;
  generatedAt: Date;
}

const MAX_LISTED_VALUES = 15;

function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** What actually occurs in this delivery: fill rate plus values or range. */
function observe(records: Array<Record<string, unknown>>, f: FieldDef) {
  let filled = 0;
  let min = Infinity;
  let max = -Infinity;
  const counts = new Map<string, number>();
  const bump = (v: unknown) => {
    if (typeof v === "number") {
      min = Math.min(min, v);
      max = Math.max(max, v);
    } else if (typeof v === "string") {
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  };
  for (const r of records) {
    const group = r[f.group] as Record<string, unknown> | undefined;
    const v = group?.[f.name];
    if (v === null || v === undefined) continue;
    filled++;
    if (Array.isArray(v)) v.forEach(bump);
    else if (typeof v === "object") Object.values(v as object).forEach(bump);
    else bump(v);
  }
  const byFrequency = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  return { filled, min, max, byFrequency };
}

function valuesCell(f: FieldDef, o: ReturnType<typeof observe>): string {
  if (f.opaque) {
    const n = o.byFrequency.length;
    return `${n.toLocaleString("en-US")} distinct in this delivery`;
  }
  if (f.values) return f.values.map((v) => `\`${v}\``).join(", ");
  if (o.byFrequency.length > 0) {
    const shown = o.byFrequency.slice(0, MAX_LISTED_VALUES).map((v) => `\`${v}\``).join(", ");
    const more = o.byFrequency.length - MAX_LISTED_VALUES;
    return more > 0 ? `${shown}, … (+${more} more)` : shown;
  }
  if (o.min !== Infinity) return o.min === o.max ? `${o.min}` : `${o.min} – ${o.max}`;
  return "—";
}

export function buildReadme(input: ReadmeInput): string {
  const { records, fields, source } = input;
  const total = records.length;
  const pct = (n: number) => (total === 0 ? "—" : `${Math.round((n / total) * 100)}%`);
  const firstId = records[0]?.sample_id;
  const lastId = records[records.length - 1]?.sample_id;
  const hasVotes = fields.some((f) => f.group === "model_votes");

  const typeRows = [1, 2, 3, 4, 5, 6, 7]
    .filter((t) => (input.perType.get(t) ?? 0) > 0)
    .map((t) => `| Type ${t} — ${BRISTOL_DESCRIPTIONS[t]} | ${input.perType.get(t)} |`)
    .join("\n");

  const dictionary = GROUPS.filter((g) => fields.some((f) => f.group === g.key))
    .map((g) => {
      const rows = fields
        .filter((f) => f.group === g.key)
        .map((f) => {
          const o = observe(records, f);
          return `| \`${f.id}\` | ${cell(f.description)} | ${cell(valuesCell(f, o))} | ${pct(o.filled)} |`;
        })
        .join("\n");
      return `### \`${g.key}\` — ${g.title}\n\n| Field | Meaning | Values | Filled |\n|---|---|---|---|\n${rows}`;
    })
    .join("\n\n");

  const formats =
    input.formats.png > 0
      ? `JPEG (${input.formats.png} PNG${input.formats.png === 1 ? "" : "s"})`
      : "JPEG";

  return `# SoftAllThings stool image dataset

Prepared for **${input.buyerName}** on ${input.generatedAt.toISOString().slice(0, 10)}.
**${total.toLocaleString("en-US")} photos**${firstId ? `, \`${firstId}\` … \`${lastId}\`` : ""}.

## What's in this folder

\`\`\`
images/          one photo per sample (${formats})
metadata.json    one record per photo
README.md        this file
\`\`\`

Each record's \`image\` field is the photo's path relative to this folder.

## Photos per Bristol type

| Bristol type | Photos |
|---|---|
${typeRows}

## Where the labels come from

${source.provenance}${
    hasVotes
      ? "\n\n`model_votes` shows what each model predicted before reconciliation: `onnx` is SoftAllThings' in-house model, `gpt` and `gemini` are commercial vision models."
      : ""
  }

## Loading the data

\`\`\`python
import json
import pandas as pd

with open("metadata.json") as f:
    records = json.load(f)

df = pd.json_normalize(records)   # columns like "labels.color", "user.sleep"
\`\`\`

## Fields

Every record has \`sample_id\` and \`image\`. The rest are grouped:

${dictionary}

## Notes

- \`null\` means the value was not recorded for that photo — not "no" and not zero.
  The *Filled* column above is the share of records in this delivery that have a value.
- \`sample_id\` is unique across every delivery we make to you, so deliveries can be merged.
- \`user.id\` is pseudonymous. It is stable across all your deliveries (the same person
  always has the same ID), cannot be linked back to an account, and is different from
  the IDs any other customer receives.
- Photos are the originals with all metadata (EXIF, location, device, timestamps)
  removed; pixel data is untouched${input.reencoded > 0 ? `, except ${input.reencoded} photo${input.reencoded === 1 ? "" : "s"} re-saved to apply rotation or remove metadata from a non-JPEG file` : ""}.
- No names, emails or account identifiers are included.
`;
}
