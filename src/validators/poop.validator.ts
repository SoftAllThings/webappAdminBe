import { CreatePoopRecord } from "../types/poop";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export const validatePagination = (
  page: number,
  limit: number
): ValidationResult => {
  if (page < 1 || limit < 1 || limit > 100) {
    return {
      valid: false,
      error:
        "Invalid pagination parameters. Page must be >= 1, limit must be between 1 and 100.",
    };
  }
  return { valid: true };
};

export const validateBristolType = (
  bristolType: number | undefined
): ValidationResult => {
  if (bristolType !== undefined && (bristolType < 1 || bristolType > 7)) {
    return {
      valid: false,
      error: "Invalid bristol_type parameter. Must be between 1 and 7.",
    };
  }
  return { valid: true };
};

const rangeValidator =
  (field: string, min: number, max: number) =>
  (value: number | undefined): ValidationResult => {
    if (value === undefined) return { valid: true };
    if (Number.isNaN(value) || value < min || value > max) {
      return {
        valid: false,
        error: `Invalid ${field} parameter. Must be between ${min} and ${max}.`,
      };
    }
    return { valid: true };
  };

export const validateColor = rangeValidator("color", 0, 6);
export const validateConsistency = rangeValidator("consistency", 0, 3);
export const validateFloating = rangeValidator("floating", 0, 1);
export const validateHealth = rangeValidator("health", 0, 1);

export const validateId = (id: string | undefined): ValidationResult => {
  if (!id) {
    return {
      valid: false,
      error: "ID parameter is required",
    };
  }
  return { valid: true };
};

export const validateCreatePoop = (
  data: Partial<CreatePoopRecord>
): ValidationResult => {
  const requiredFields = [
    "bristol_type",
    "consistency",
    "shape",
    "quantity",
    "color",
    "health",
  ];

  const missingFields = requiredFields.filter(
    (field) => data[field as keyof CreatePoopRecord] === undefined
  );

  if (missingFields.length > 0) {
    return {
      valid: false,
      error: `Missing required fields: ${missingFields.join(", ")}`,
    };
  }

  return { valid: true };
};

export const ALLOWED_SEARCH_FIELDS = [
  "bristol_type",
  "consistency",
  "shape",
  "quantity",
  "color",
  "health",
  "blood",
  "mucus",
  "floating",
  "verified",
] as const;

export const parseSearchCriteria = (
  query: Record<string, any>
): Record<string, any> => {
  const criteria: Record<string, any> = {};

  ALLOWED_SEARCH_FIELDS.forEach((field) => {
    if (query[field] !== undefined) {
      const value = query[field] as string;
      if (field === "verified") {
        criteria[field] = value.toLowerCase() === "true";
      } else {
        criteria[field] = parseInt(value);
      }
    }
  });

  return criteria;
};
