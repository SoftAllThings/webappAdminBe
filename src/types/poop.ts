// TypeScript interfaces for the Poop data structure
// Based on the app.poop table schema

export interface PoopRecord {
  id: string;
  bristol_type: number;
  consistency: number;
  shape: number;
  quantity: number;
  color: number;
  health: number;
  blood: number;
  mucus: number;
  floating: number;
  smell_level: number;
  pain_level: number;
  duration: number;
  verified: boolean;
  liver_flukes: number;
  colon_cancer: number;
  hemorrhoids: number;
  anal_fissures: number;
  crohns_disease: number;
  ulcerative_colitis: number;
  celiac_disease: number;
  gallbladder_disease: number;
  pancreatitis: number;
  liver_disease: number;
  upper_gastrointestinal_bleeding: number;
  gastrointestinal_infection: number;
  lactose_intolerance: number;
  food_poisoning: number;
  diverticulitis: number;
  irritable_bowel_syndrome: number;
  constipation: number;
  dehydration: number;
  hypothyroidism: number;
  bile_duct_obstruction: number;
  malabsorption_syndrome: number;
  rapid_gastrointestinal_transit: number;
  created_at?: string;
  updated_at?: string;
  s3_key?: string | null;
  s3_url?: string | null;
  gpt_bristol_type?: string | null;
}

// For creating new records (without ID and timestamps)
export interface CreatePoopRecord {
  bristol_type: number;
  consistency: number;
  shape: number;
  quantity: number;
  color: number;
  health: number;
  blood: number;
  mucus: number;
  floating: number;
  smell_level: number;
  pain_level: number;
  duration: number;
  verified?: boolean;
  liver_flukes?: number;
  colon_cancer?: number;
  hemorrhoids?: number;
  anal_fissures?: number;
  crohns_disease?: number;
  ulcerative_colitis?: number;
  celiac_disease?: number;
  gallbladder_disease?: number;
  pancreatitis?: number;
  liver_disease?: number;
  upper_gastrointestinal_bleeding?: number;
  gastrointestinal_infection?: number;
  lactose_intolerance?: number;
  food_poisoning?: number;
  diverticulitis?: number;
  irritable_bowel_syndrome?: number;
  constipation?: number;
  dehydration?: number;
  hypothyroidism?: number;
  bile_duct_obstruction?: number;
  malabsorption_syndrome?: number;
  rapid_gastrointestinal_transit?: number;
  s3_key?: string | null;
  s3_url?: string | null;
  gpt_bristol_type?: string | null;
}

// For updating existing records (all fields optional except ID)
export interface UpdatePoopRecord {
  id: string;
  bristol_type?: number;
  consistency?: number;
  shape?: number;
  quantity?: number;
  color?: number;
  health?: number;
  blood?: number;
  mucus?: number;
  floating?: number;
  smell_level?: number;
  pain_level?: number;
  duration?: number;
  verified?: boolean;
  liver_flukes?: number;
  colon_cancer?: number;
  hemorrhoids?: number;
  anal_fissures?: number;
  crohns_disease?: number;
  ulcerative_colitis?: number;
  celiac_disease?: number;
  gallbladder_disease?: number;
  pancreatitis?: number;
  liver_disease?: number;
  upper_gastrointestinal_bleeding?: number;
  gastrointestinal_infection?: number;
  lactose_intolerance?: number;
  food_poisoning?: number;
  diverticulitis?: number;
  irritable_bowel_syndrome?: number;
  constipation?: number;
  dehydration?: number;
  hypothyroidism?: number;
  bile_duct_obstruction?: number;
  malabsorption_syndrome?: number;
  rapid_gastrointestinal_transit?: number;
  s3_key?: string | null;
  s3_url?: string | null;
  gpt_bristol_type?: string | null;
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
  };
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
  };
}

export interface PoopListResponse extends ApiResponse<PoopRecord[]> {
  meta: {
    total: number;
    page: number;
    limit: number;
    bristolType?: number;
  };
}

export interface PoopDetailResponse extends ApiResponse<PoopRecord> {}

// Enum-like constants for the numeric values
export const BRISTOL_TYPES = {
  1: "Separate hard lumps",
  2: "Lumpy and sausage-like",
  3: "A sausage shape with cracks in the surface",
  4: "Like a smooth, soft sausage or snake",
  5: "Soft blobs with clear-cut edges",
  6: "Mushy consistency with ragged edges",
  7: "Liquid consistency with no solid pieces",
} as const;

export const CONSISTENCY_TYPES = {
  0: "Very hard",
  1: "Hard",
  2: "Normal",
  3: "Soft",
  4: "Very soft",
} as const;

export const SHAPE_TYPES = {
  0: "Normal",
  1: "Lumpy",
  2: "Smooth",
  3: "Cracked",
  4: "Fragmented",
} as const;

export const COLOR_TYPES = {
  0: "Brown",
  1: "Dark brown",
  2: "Light brown",
  3: "Yellow",
  4: "Green",
  5: "Black",
  6: "Red",
  7: "Other",
} as const;
