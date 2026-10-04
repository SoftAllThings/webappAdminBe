import { LABELS, CONDITION_LEVELS, type LabelField } from "./labelMapping";

/**
 * What a buyer data sample can contain.
 *
 * Every exportable field is declared here once: which sources carry it, how
 * it is decoded from a fetched row (ints → strings, app answer codes → the
 * answer text the user actually saw), and how the README describes it. The
 * admin UI renders its pickers and JSON preview from the same list, so the
 * dashboard, the zip and the README cannot drift apart.
 */

// ------------------------------------------------------------------ sources

export type SourceKey = "ready_to_train" | "app_poop" | "stool_logs";
export type SourceTable = "app.poop" | "softai.stool_logs";

export const sourceTable = (s: SourceKey): SourceTable =>
  s === "stool_logs" ? "softai.stool_logs" : "app.poop";

export type OptionKey =
  | "excludeSentToBuyer"
  | "excludeSentToAnyBuyer"
  | "includeRejected"
  | "includeWebDemo"
  | "includeMinors";

export interface SourceDef {
  key: SourceKey;
  title: string;
  table: string;
  tagline: string;
  highlights: string[];
  warnings: string[];
  /** Source-specific toggles shown in the UI (the buyer toggles apply to all). */
  options: OptionKey[];
  /** Buyer-facing "where the labels come from" paragraph for the README. */
  provenance: string;
  /** Rough average image size, for the download-size estimate. */
  avgImageBytes: number;
}

export const SOURCES: SourceDef[] = [
  {
    key: "ready_to_train",
    title: "Human-verified",
    table: "app.readyToTrainView",
    tagline: "Photos a reviewer approved in AI Review. Highest label quality.",
    highlights: [
      "Every label checked — and corrected where needed — by a reviewer",
      "Logged Oct 2025 – Apr 2026 with the older app",
      "It's app.poop filtered to approved rows, so user, date and symptom fields are available too",
    ],
    warnings: ["Smallest set; Types 1, 2 and 7 run out first"],
    options: [],
    provenance:
      "Photos submitted by users of the PoopCheck app between October 2025 and April 2026. " +
      "The user chose the Bristol type when logging and an AI model suggested the other attributes. " +
      "Every photo in this set was then reviewed by a SoftAllThings annotator, who confirmed the photo " +
      "is usable and checked — and corrected where needed — every label.",
    avgImageBytes: 650_000,
  },
  {
    key: "app_poop",
    title: "All legacy logs",
    table: "app.poop",
    tagline: "Every photo from the older app pipeline, reviewed or not.",
    highlights: [
      "~140k photos from ~9.5k users, Oct 2025 – Apr 2026",
      "Bristol type chosen by the user; other labels are AI suggestions unless a reviewer approved the photo",
      "meta.review_status tells the buyer which photos a person checked",
    ],
    warnings: [
      "~80% never reviewed by a person",
      "Where the AI returned nothing, the import stored a default (e.g. color → brown)",
    ],
    options: ["includeRejected"],
    provenance:
      "Photos submitted by users of the PoopCheck app between October 2025 and April 2026. " +
      "The user chose the Bristol type when logging. All other stool attributes are AI suggestions " +
      "generated when the photo was logged; where the AI returned nothing a default was stored " +
      "(consistency = normal, shape = sausage, quantity = normal, color = brown, blood and mucus = none, " +
      "floating = sink, health = healthy), so treat those values as weaker evidence. " +
      "`meta.review_status` (when included) shows whether a SoftAllThings annotator reviewed the photo; " +
      "approved photos have human-checked labels.",
    avgImageBytes: 650_000,
  },
  {
    key: "stool_logs",
    title: "Current app (AI-labelled)",
    table: "softai.stool_logs",
    tagline: "Every log since March 2026, labelled by the 3-model AI ensemble.",
    highlights: [
      "~53k photos from ~3.5k people, Mar 2026 → today",
      "Confidence score per label",
      "Per-log lifestyle answers + the user's profile at the time of the log",
    ],
    warnings: [
      "Labels are AI predictions — nobody reviewed them",
      "Lifestyle answers are optional in the app: present on about half the logs",
    ],
    options: ["includeWebDemo"],
    provenance:
      "Photos submitted by users of the PoopCheck app since March 2026. Every label is a prediction " +
      "from SoftAllThings' AI analysis — several vision models whose answers are reconciled per " +
      "attribute — and none were reviewed by a person. Use the `confidence` fields (when included) to " +
      "keep only high-certainty labels. The lifestyle questions are optional in the app, so `log` " +
      "fields are present on roughly half of the photos; `user` profile fields reflect what the user " +
      "had entered in their profile at the time of the log.",
    avgImageBytes: 200_000,
  },
];

// ------------------------------------------------------------------- groups

export type GroupKey =
  | "labels"
  | "confidence"
  | "model_votes"
  | "user"
  | "log"
  | "conditions"
  | "meta";

export interface GroupDef {
  key: GroupKey;
  title: string;
  description: string;
  warning?: string;
}

export const GROUPS: GroupDef[] = [
  {
    key: "labels",
    title: "Stool labels",
    description: "The nine attributes of the stool in the photo.",
  },
  {
    key: "confidence",
    title: "Label confidence",
    description: "How sure the AI was about each label, 0–1.",
  },
  {
    key: "model_votes",
    title: "Per-model predictions",
    description:
      "What each model in the ensemble predicted before reconciliation (gpt, gemini, onnx). Logs analysed before the ensemble existed have none.",
  },
  {
    key: "user",
    title: "User",
    description:
      "Pseudonymous person ID plus profile answers. For legacy logs the profile is the user's current one, and only ~12% of those users have one.",
  },
  {
    key: "log",
    title: "Log details",
    description: "What the user answered about this particular log.",
  },
  {
    key: "conditions",
    title: "AI condition screening",
    description: "22 condition risk levels the AI produced from the photo at log time.",
    warning:
      "These are an AI's guesses from a photo (e.g. colon_cancer: high), not diagnoses. The README says so, but think twice before selling them as labels.",
  },
  {
    key: "meta",
    title: "Metadata",
    description: "When the photo was logged and how it was reviewed.",
  },
];

// ------------------------------------------------------------------- fields

/** One row from the download query (see sampling.ts → fetchRows). */
export type SourceRow = Record<string, unknown>;

export interface FieldContext {
  /** Per-buyer pseudonym for a person, or null for anonymous rows. */
  pseudonymize(personRef: string | null): string | null;
}

export interface FieldDef {
  /** `<group>.<name>` — also the dotted column name pandas.json_normalize produces. */
  id: string;
  group: GroupKey;
  name: string;
  title: string;
  description: string;
  /** Allowed values, when the set is fixed. */
  values?: readonly string[];
  /** Values are identifiers: the README reports a distinct count, not a list. */
  opaque?: boolean;
  sources: readonly SourceKey[];
  defaultOn: boolean;
  example: unknown;
  extract(row: SourceRow, ctx: FieldContext): unknown;
}

const ALL: readonly SourceKey[] = ["ready_to_train", "app_poop", "stool_logs"];
const LEGACY: readonly SourceKey[] = ["ready_to_train", "app_poop"];
const CURRENT: readonly SourceKey[] = ["stool_logs"];

// --- value helpers

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function asNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** app.poop stores 4; stool_logs stores 'Type 4'. Both become "Type 4". */
function bristolLabel(v: unknown): string | null {
  if (typeof v === "number") return v >= 1 && v <= 7 ? `Type ${v}` : null;
  const m = /[1-7]/.exec(String(v ?? ""));
  return m ? `Type ${m[0]}` : null;
}

/** app.poop: integer code → mapping.json label. stool_logs: already a label. */
function decodeLabel(field: LabelField, v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    // An unknown code passes through rather than silently becoming null.
    return LABELS[field][v] ?? String(v);
  }
  return asString(v)?.toLowerCase() ?? null;
}

// Spelling drift between app versions for the same answer.
const ANSWER_VARIANTS: Record<string, string> = {
  "12-5pm": "12-5 pm",
  "6-11pm": "6-11 pm",
  "12-5am": "12-5 am",
  "6-11am": "6-11 am",
  "<1 h ago": "<1 h",
  "+12 h": "12 h+",
};

function answer(v: unknown): string | null {
  const s = asString(v);
  return s === null ? null : ANSWER_VARIANTS[s] ?? s;
}

function answerList(v: unknown): string[] | null {
  if (Array.isArray(v)) {
    const items = v.map(answer).filter((x): x is string => x !== null);
    return items.length ? items : null;
  }
  const s = asString(v);
  return s === null ? null : s.split(/\s*,\s*/).filter(Boolean);
}

/** The app sends some answers as codes; map them back to the option text. */
function codedAnswer(map: Record<number, string>, v: unknown): string | null {
  const n = asNumber(v);
  if (n === null) return null;
  return map[n] ?? String(n);
}

// Codes from PoopCheck src/utils/mapAnswersToDetails.ts. 0 = "No Smell" AND
// "Not sure" — the app collapses both onto the same code.
const SMELL_CODES: Record<number, string> = {
  0: "No Smell / Not sure",
  1: "Normal",
  2: "Slightly More",
  3: "Much Stronger",
};
const DURATION_CODES: Record<number, string> = {
  0: "Not sure",
  1: "<1 min",
  2: "1-3 min",
  4: "3-5 min",
  6: ">5 min",
};
const WATER_CODES: Record<number, string> = {
  1: "<1 L",
  2: "1-2 L",
  3: "2-3 L",
  4: "+3 L",
};

function profile(row: SourceRow): Record<string, unknown> | null {
  return asObject(row.profile_json);
}

// --- labels / confidence / votes (one entry per label column)

const LABEL_SPECS: Array<{
  name: "bristol_type" | LabelField;
  title: string;
  description: string;
  /** Key of this label inside ensemble_metadata.perModel.<model>.fields */
  voteKey: string;
  example: string;
}> = [
  {
    name: "bristol_type",
    title: "Bristol type",
    description: "Bristol Stool Scale: Type 1 (separate hard lumps) … Type 7 (entirely liquid).",
    voteKey: "bristolType",
    example: "Type 4",
  },
  { name: "consistency", title: "Consistency", description: "Overall firmness.", voteKey: "consistency", example: "normal" },
  { name: "shape", title: "Shape", description: "Overall form.", voteKey: "shape", example: "sausage" },
  { name: "quantity", title: "Quantity", description: "Amount relative to a typical stool.", voteKey: "quantity", example: "normal" },
  { name: "color", title: "Color", description: "Dominant color.", voteKey: "color", example: "brown" },
  { name: "health", title: "Health", description: "Whether the stool looks healthy overall.", voteKey: "health", example: "healthy" },
  { name: "blood", title: "Blood", description: "Visible blood.", voteKey: "blood", example: "none" },
  { name: "mucus", title: "Mucus", description: "Visible mucus.", voteKey: "mucus", example: "none" },
  { name: "floating", title: "Floating", description: "Whether the stool floats or sinks.", voteKey: "floating", example: "sink" },
];

const BRISTOL_VALUES = ["Type 1", "Type 2", "Type 3", "Type 4", "Type 5", "Type 6", "Type 7"];

function labelValue(name: "bristol_type" | LabelField, v: unknown): string | null {
  return name === "bristol_type" ? bristolLabel(v) : decodeLabel(name, v);
}

const labelFields: FieldDef[] = LABEL_SPECS.map((spec) => ({
  id: `labels.${spec.name}`,
  group: "labels",
  name: spec.name,
  title: spec.title,
  description: spec.description,
  values: spec.name === "bristol_type" ? BRISTOL_VALUES : LABELS[spec.name],
  sources: ALL,
  defaultOn: true,
  example: spec.example,
  extract: (row) => labelValue(spec.name, row[spec.name]),
}));

const confidenceFields: FieldDef[] = LABEL_SPECS.map((spec) => ({
  id: `confidence.${spec.name}`,
  group: "confidence",
  name: spec.name,
  title: `${spec.title} confidence`,
  description: `Confidence of labels.${spec.name}, 0–1.`,
  sources: CURRENT,
  defaultOn: false,
  example: 0.93,
  extract: (row) => asNumber(row[`${spec.name}_confidence`]),
}));

const VOTING_MODELS = ["gpt", "gemini", "onnx"] as const;

const modelVoteFields: FieldDef[] = LABEL_SPECS.map((spec) => ({
  id: `model_votes.${spec.name}`,
  group: "model_votes",
  name: spec.name,
  title: `${spec.title} votes`,
  description: `Each model's prediction for labels.${spec.name}, as {gpt, gemini, onnx}. A model that failed or did not run is null.`,
  sources: CURRENT,
  defaultOn: false,
  example: { gpt: spec.example, gemini: spec.example, onnx: spec.example },
  extract: (row) => {
    const perModel = asObject(row.model_votes_json);
    if (!perModel) return null;
    const out: Record<string, string | null> = {};
    for (const model of VOTING_MODELS) {
      const m = asObject(perModel[model]);
      const fields = m && m.ok === true ? asObject(m.fields) : null;
      const vote = fields ? asObject(fields[spec.voteKey]) : null;
      out[model] = vote ? labelValue(spec.name, vote.label) : null;
    }
    return out;
  },
}));

// --- user

const PROFILE_SPECS: Array<{ name: string; key: string; title: string; description: string; example: string }> = [
  { name: "age", key: "age", title: "Age band", description: "Age band from the user's profile.", example: "30-39" },
  { name: "sex", key: "sex", title: "Sex", description: "Sex from the user's profile.", example: "Female" },
  { name: "height", key: "height", title: "Height band", description: "Height band, in the units the user chose (cm or ft/in).", example: "160-170 cm" },
  { name: "weight", key: "weight", title: "Weight band", description: "Weight band, in the units the user chose (kg or lbs).", example: "60-75 kg" },
  { name: "sleep", key: "sleep", title: "Usual sleep", description: "How much the user usually sleeps (profile). Not last night — see log.sleep_last_night.", example: "7-8h" },
  { name: "hydration", key: "hydration", title: "Usual hydration", description: "How much the user usually drinks per day (profile).", example: "1-2L" },
  { name: "stress", key: "stressLevel", title: "Usual stress", description: "The user's usual stress level (profile).", example: "Moderate" },
  { name: "coffee_alcohol", key: "coffeeAlcohol", title: "Coffee / alcohol habits", description: "The user's usual coffee and alcohol consumption (profile).", example: "Only coffee" },
  { name: "diet", key: "diet", title: "Diet", description: "The user's usual diet (profile).", example: "Balanced" },
  { name: "sensitivities", key: "sensitivities", title: "Known sensitivities", description: "Self-reported digestive conditions or sensitivities (profile), e.g. IBS, lactose intolerance.", example: "None" },
];

const userFields: FieldDef[] = [
  {
    id: "user.id",
    group: "user",
    name: "id",
    title: "User ID (pseudonymous)",
    description:
      "Pseudonymous person ID. Stable across every delivery to you, so photos can be grouped by person (e.g. for train/test splits); not linkable to an account, and different from the IDs other customers receive. null for anonymous web uploads.",
    sources: ALL,
    defaultOn: true,
    opaque: true,
    example: "u_3f9a1c2b7d4e",
    extract: (row, ctx) => ctx.pseudonymize(asString(row.person_ref)),
  },
  ...PROFILE_SPECS.map(
    (spec): FieldDef => ({
      id: `user.${spec.name}`,
      group: "user",
      name: spec.name,
      title: spec.title,
      description: spec.description,
      sources: ALL,
      defaultOn: true,
      example: spec.example,
      extract: (row) => asString(profile(row)?.[spec.key]),
    }),
  ),
];

// --- log (per-log answers). Question text is quoted from the app so the
// buyer knows exactly what was asked.

const logFields: FieldDef[] = [
  {
    id: "log.last_meal_timing",
    group: "log",
    name: "last_meal_timing",
    title: "Time since last meal",
    description: "\"When did you have your last meal?\"",
    values: ["<1 h", "1-3 h", "3-6 h", "6-12 h", "12 h+", "Not sure"],
    sources: CURRENT,
    defaultOn: true,
    example: "1-3 h",
    extract: (row) => answer(row.last_meal),
  },
  {
    id: "log.last_meal_type",
    group: "log",
    name: "last_meal_type",
    title: "Last meal type",
    description: "\"What best describes your last meal?\" (multi-select, list of strings)",
    values: ["Balanced", "Small snack", "High fat / fried", "Spicy", "Takeaway / fast food", "Not Sure"],
    sources: CURRENT,
    defaultOn: true,
    example: ["Balanced"],
    extract: (row) => answerList(row.food_groups),
  },
  {
    id: "log.water_last_24h",
    group: "log",
    name: "water_last_24h",
    title: "Water in the last 24h",
    description: "\"How much did you drink in the last 24h?\" (\"Not sure\" is stored as null)",
    values: Object.values(WATER_CODES),
    sources: CURRENT,
    defaultOn: true,
    example: "1-2 L",
    extract: (row) => codedAnswer(WATER_CODES, row.water_glasses),
  },
  {
    id: "log.discomfort",
    group: "log",
    name: "discomfort",
    title: "Discomfort",
    description: "\"Any discomfort while pooping?\" (multi-select, list of strings)",
    values: ["No", "Hard to pass", "Burning", "Sharp pain", "Slight pain", "Not sure"],
    sources: CURRENT,
    defaultOn: true,
    example: ["No"],
    extract: (row) => answerList(row.discomfort),
  },
  {
    id: "log.duration",
    group: "log",
    name: "duration",
    title: "Duration",
    description: "\"How long did it take?\"",
    values: Object.values(DURATION_CODES),
    sources: CURRENT,
    defaultOn: true,
    example: "1-3 min",
    extract: (row) => codedAnswer(DURATION_CODES, row.duration_minutes),
  },
  {
    id: "log.times_today",
    group: "log",
    name: "times_today",
    title: "Times today",
    description: "\"How many times have you pooped so far today?\"",
    values: ["0", "1", "2", "3+", "Not sure"],
    sources: CURRENT,
    defaultOn: true,
    example: "1",
    extract: (row) => answer(row.frequency),
  },
  {
    id: "log.sleep_last_night",
    group: "log",
    name: "sleep_last_night",
    title: "Sleep last night",
    description: "\"How much did you sleep last night?\" (a few early logs use older bands such as \"7-8 h\")",
    values: ["7-9 h", "6-7 h", "4-6 h", "<4h", "Not sure"],
    sources: CURRENT,
    defaultOn: true,
    example: "7-9 h",
    extract: (row) => answer(row.sleep),
  },
  {
    id: "log.stress_today",
    group: "log",
    name: "stress_today",
    title: "Stress today",
    description: "\"How does your day feel so far?\"",
    values: ["Relaxed", "Busy day", "Quite Stressed", "Exhausted", "Not Sure"],
    sources: CURRENT,
    defaultOn: true,
    example: "Relaxed",
    extract: (row) => answer(row.stress),
  },
  {
    id: "log.toilet_time",
    group: "log",
    name: "toilet_time",
    title: "Time of day",
    description: "\"When did you go to the toilet?\"",
    values: ["6-11 am", "12-5 pm", "6-11 pm", "12-5 am", "Not sure"],
    sources: CURRENT,
    defaultOn: true,
    example: "6-11 am",
    extract: (row) => answer(row.toilet_time),
  },
  {
    id: "log.smell",
    group: "log",
    name: "smell",
    title: "Smell",
    description: "\"Did it smell stronger than usual?\" (the app stores \"No Smell\" and \"Not sure\" identically)",
    values: Object.values(SMELL_CODES),
    sources: CURRENT,
    defaultOn: true,
    example: "Normal",
    extract: (row) => codedAnswer(SMELL_CODES, row.smell_level),
  },
  {
    id: "log.coffee_alcohol_last_12h",
    group: "log",
    name: "coffee_alcohol_last_12h",
    title: "Coffee / alcohol (last 12h)",
    description: "\"Coffee or alcohol in the last 12h?\"",
    values: ["No", "Only Coffee", "Only alcohol", "Both", "Not Sure"],
    sources: CURRENT,
    defaultOn: true,
    example: "Only Coffee",
    extract: (row) => answer(row.caffeine),
  },
  // Older app: free sliders, stored as numbers. Kept numeric — they are
  // scales, not codes. 0 means "not sent"; most logs carry the slider's
  // starting value (1) because users rarely moved it.
  {
    id: "log.smell_level",
    group: "log",
    name: "smell_level",
    title: "Smell level (0–10)",
    description: "Smell slider in the older app, 0–10. 0 = not recorded; most logs carry the slider's starting value (1).",
    sources: LEGACY,
    defaultOn: false,
    example: 1,
    extract: (row) => asNumber(row.smell_level),
  },
  {
    id: "log.pain_level",
    group: "log",
    name: "pain_level",
    title: "Pain level (0–10)",
    description: "Pain slider in the older app, 0–10. 0 = not recorded; most logs carry the slider's starting value (1).",
    sources: LEGACY,
    defaultOn: false,
    example: 1,
    extract: (row) => asNumber(row.pain_level),
  },
  {
    id: "log.duration_minutes",
    group: "log",
    name: "duration_minutes",
    title: "Duration (minutes)",
    description: "Duration entered in the older app, in minutes. 1 is also what the import stored when nothing was entered.",
    sources: LEGACY,
    defaultOn: false,
    example: 5,
    extract: (row) => asNumber(row.duration),
  },
];

// --- conditions (legacy only)

const CONDITIONS = [
  "liver_flukes",
  "colon_cancer",
  "hemorrhoids",
  "anal_fissures",
  "crohns_disease",
  "ulcerative_colitis",
  "celiac_disease",
  "gallbladder_disease",
  "pancreatitis",
  "liver_disease",
  "upper_gastrointestinal_bleeding",
  "gastrointestinal_infection",
  "lactose_intolerance",
  "food_poisoning",
  "diverticulitis",
  "irritable_bowel_syndrome",
  "constipation",
  "dehydration",
  "hypothyroidism",
  "bile_duct_obstruction",
  "malabsorption_syndrome",
  "rapid_gastrointestinal_transit",
] as const;

function conditionTitle(name: string): string {
  if (name === "crohns_disease") return "Crohn's disease";
  const words = name.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const conditionFields: FieldDef[] = CONDITIONS.map((name) => ({
  id: `conditions.${name}`,
  group: "conditions",
  name,
  title: conditionTitle(name),
  description: `AI-estimated risk of ${conditionTitle(name).toLowerCase()} from the photo at log time. Not a diagnosis.`,
  values: CONDITION_LEVELS,
  sources: LEGACY,
  defaultOn: false,
  example: "low",
  extract: (row) => {
    const n = asNumber(row[name]);
    return n === null ? null : CONDITION_LEVELS[n] ?? String(n);
  },
}));

// --- meta

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const metaFields: FieldDef[] = [
  {
    id: "meta.logged_on",
    group: "meta",
    name: "logged_on",
    title: "Date logged",
    description: "Date the photo was logged (UTC), YYYY-MM-DD.",
    sources: ALL,
    defaultOn: true,
    example: "2026-05-14",
    extract: (row) => toDate(row.created_at)?.toISOString().slice(0, 10) ?? null,
  },
  {
    id: "meta.logged_at",
    group: "meta",
    name: "logged_at",
    title: "Exact time logged",
    description: "Exact time the photo was logged (UTC, ISO 8601).",
    sources: ALL,
    defaultOn: false,
    example: "2026-05-14T07:42:10.000Z",
    extract: (row) => toDate(row.created_at)?.toISOString() ?? null,
  },
  {
    id: "meta.timezone",
    group: "meta",
    name: "timezone",
    title: "Time zone",
    description: "The user's time zone when logging (IANA name, e.g. Europe/Madrid).",
    sources: CURRENT,
    defaultOn: false,
    example: "Europe/Madrid",
    extract: (row) => asString(row.timezone),
  },
  {
    id: "meta.review_status",
    group: "meta",
    name: "review_status",
    title: "Review status",
    description:
      "approved = a SoftAllThings annotator checked the photo and its labels; rejected = judged unusable for training; not_reviewed = labels as generated at log time.",
    values: ["approved", "rejected", "not_reviewed"],
    sources: ["app_poop"],
    defaultOn: true,
    example: "approved",
    extract: (row) =>
      row.image_good_for_ml === true
        ? "approved"
        : row.image_good_for_ml === false
          ? "rejected"
          : "not_reviewed",
  },
  {
    id: "meta.ai_bristol_type",
    group: "meta",
    name: "ai_bristol_type",
    title: "AI's Bristol suggestion",
    description:
      "Bristol type the AI suggested when the photo was logged, before the user's choice and any review. Compare with labels.bristol_type.",
    values: BRISTOL_VALUES,
    sources: LEGACY,
    defaultOn: false,
    example: "Type 4",
    extract: (row) => bristolLabel(row.gpt_bristol_type),
  },
];

export const FIELDS: FieldDef[] = [
  ...labelFields,
  ...confidenceFields,
  ...modelVoteFields,
  ...userFields,
  ...logFields,
  ...conditionFields,
  ...metaFields,
];

const FIELD_BY_ID = new Map(FIELDS.map((f) => [f.id, f]));

export function getField(id: string): FieldDef | undefined {
  return FIELD_BY_ID.get(id);
}

export const BRISTOL_DESCRIPTIONS: Record<number, string> = {
  1: "Separate hard lumps",
  2: "Lumpy, sausage-shaped",
  3: "Sausage with cracks",
  4: "Smooth, soft sausage",
  5: "Soft blobs, clear edges",
  6: "Mushy, ragged edges",
  7: "Entirely liquid",
};

/** The catalog as the admin UI sees it (no extractors). */
export function publicCatalog() {
  return {
    sources: SOURCES,
    groups: GROUPS,
    fields: FIELDS.map(({ extract: _extract, ...rest }) => rest),
    bristolTypes: [1, 2, 3, 4, 5, 6, 7].map((type) => ({
      type,
      label: `Type ${type}`,
      description: BRISTOL_DESCRIPTIONS[type] ?? "",
    })),
  };
}
