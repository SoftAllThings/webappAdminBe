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

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedMeta {
  total: number;
  page: number;
  limit: number;
}
