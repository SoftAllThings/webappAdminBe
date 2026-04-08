import {
  CollectionReference,
  Query,
  Timestamp,
} from "firebase-admin/firestore";
import { db } from "../config/firebase";

export type UserExportFilters = {
  premium?: boolean;
  createdAtFrom?: string;
  createdAtTo?: string;
};

export type UserExportRequest = {
  useCollectionGroup?: boolean;
  filters?: UserExportFilters;
};

type ExportUserRow = {
  userId: string;
  email: string;
  createdAtDate: string;
  premium: string;
  platform: string;
};

const escapeCsvValue = (value: string): string => {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
};

const formatCreatedAtDate = (value: unknown): string => {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  if (value instanceof Timestamp) {
    return value.toDate().toISOString().slice(0, 10);
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
  }

  return "";
};

const readPremiumValue = (
  doc: FirebaseFirestore.QueryDocumentSnapshot
): boolean | undefined => {
  const premium = doc.get("premium");
  if (typeof premium === "boolean") {
    return premium;
  }

  const premiumUpper = doc.get("Premium");
  if (typeof premiumUpper === "boolean") {
    return premiumUpper;
  }

  return undefined;
};

const matchesCreatedAtRange = (
  createdAtDate: string,
  filters: UserExportFilters
): boolean => {
  if (!createdAtDate) {
    return false;
  }

  if (filters.createdAtFrom && createdAtDate < filters.createdAtFrom) {
    return false;
  }

  if (filters.createdAtTo && createdAtDate > filters.createdAtTo) {
    return false;
  }

  return true;
};

const normalizePlatformValue = (value: string): string => {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    return "";
  }

  if (
    normalized.includes("ios") ||
    normalized.includes("iphone") ||
    normalized.includes("ipad") ||
    normalized === "apple"
  ) {
    return "iPhone";
  }

  if (normalized.includes("android")) {
    return "Android";
  }

  return value.trim();
};

const readPlatformValue = (
  doc: FirebaseFirestore.QueryDocumentSnapshot
): string => {
  const possibleFields = [
    "platform",
    "Platform",
    "devicePlatform",
    "device_platform",
    "os",
    "OS",
    "operatingSystem",
    "deviceOs",
  ];

  for (const fieldName of possibleFields) {
    const value = doc.get(fieldName);
    if (typeof value === "string" && value.trim() !== "") {
      return normalizePlatformValue(value);
    }
  }

  return "";
};

export class UserExportService {
  private buildUsersQuery(
    request: UserExportRequest
  ): Query | CollectionReference {
    const { useCollectionGroup = false } = request;

    let query: Query | CollectionReference = useCollectionGroup
      ? db.collectionGroup("users")
      : db.collection("users");

    return query;
  }

  private mapDocToRow(
    doc: FirebaseFirestore.QueryDocumentSnapshot,
    filters: UserExportFilters
  ): ExportUserRow | null {
    const email = doc.get("email");

    if (typeof email !== "string" || email.trim() === "") {
      return null;
    }

    const premium = readPremiumValue(doc);

    if (
      typeof filters.premium === "boolean" &&
      premium !== filters.premium
    ) {
      return null;
    }

    const createdAtDate = formatCreatedAtDate(doc.get("createdAt"));

    if (
      (filters.createdAtFrom || filters.createdAtTo) &&
      !matchesCreatedAtRange(createdAtDate, filters)
    ) {
      return null;
    }

    return {
      userId: doc.id,
      email: email.trim(),
      createdAtDate,
      premium: typeof premium === "boolean" ? String(premium) : "",
      platform: readPlatformValue(doc),
    };
  }

  async exportUsersCsv(request: UserExportRequest): Promise<string> {
    const filters = request.filters ?? {};
    const snapshot = await this.buildUsersQuery(request).get();

    const rows = snapshot.docs
      .map((doc) => this.mapDocToRow(doc, filters))
      .filter((row): row is ExportUserRow => row !== null);

    const header = ["userId", "email", "createdAtDate", "premium", "platform"];
    const csvRows = rows.map((row) =>
      [
        escapeCsvValue(row.userId),
        escapeCsvValue(row.email),
        escapeCsvValue(row.createdAtDate),
        escapeCsvValue(row.premium),
        escapeCsvValue(row.platform),
      ].join(",")
    );

    return [header.join(","), ...csvRows].join("\n");
  }
}

export const userExportService = new UserExportService();
