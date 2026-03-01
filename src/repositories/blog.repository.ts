import { pool } from "../config/database";

export interface BlogPostRow {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content_html: string;
  content_text: string | null;
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  meta_title: string | null;
  meta_description: string | null;
  target_keywords: string[] | null;
  twitter_snippet: string | null;
  linkedin_snippet: string | null;
  research_sources: unknown | null;
  topic_rationale: string | null;
  related_post_ids: string[] | null;
  status: string;
  published_at: string;
  generation_model: string | null;
  generation_duration_ms: number | null;
  pipeline_log: unknown | null;
  created_at: string;
  updated_at: string;
}

export interface BlogImageRow {
  id: string;
  post_id: string;
  image_type: string;
  s3_key: string;
  s3_url: string;
  alt_text: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  file_size_bytes: number | null;
  mime_type: string;
  prompt_used: string | null;
  position_in_post: number;
  created_at: string;
}

export interface BlogTagRow {
  id: string;
  name: string;
  slug: string;
}

export interface BlogCategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface PaginatedResult<T> {
  rows: T[];
  total: number;
}

export class BlogRepository {
  async findAllPosts(
    offset: number,
    limit: number,
    filters?: { category?: string; tag?: string; search?: string }
  ): Promise<PaginatedResult<BlogPostRow>> {
    const conditions: string[] = ["p.status = 'published'"];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters?.category) {
      conditions.push(`c.slug = $${paramIndex}`);
      params.push(filters.category);
      paramIndex++;
    }

    if (filters?.tag) {
      conditions.push(`EXISTS (
        SELECT 1 FROM blog.post_tags pt2
        JOIN blog.tags t2 ON pt2.tag_id = t2.id
        WHERE pt2.post_id = p.id AND t2.slug = $${paramIndex}
      )`);
      params.push(filters.tag);
      paramIndex++;
    }

    if (filters?.search) {
      conditions.push(
        `to_tsvector('english', coalesce(p.title, '') || ' ' || coalesce(p.content_text, '')) @@ plainto_tsquery('english', $${paramIndex})`
      );
      params.push(filters.search);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM blog.posts p
      LEFT JOIN blog.categories c ON p.category_id = c.id
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0]?.total || "0");

    // Data
    const dataQuery = `
      SELECT
        p.*,
        c.name as category_name,
        c.slug as category_slug
      FROM blog.posts p
      LEFT JOIN blog.categories c ON p.category_id = c.id
      ${whereClause}
      ORDER BY p.published_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const result = await pool.query(dataQuery, [...params, limit, offset]);

    return { rows: result.rows, total };
  }

  async findPostById(id: string): Promise<BlogPostRow | null> {
    const result = await pool.query(
      `SELECT p.*, c.name as category_name, c.slug as category_slug
       FROM blog.posts p
       LEFT JOIN blog.categories c ON p.category_id = c.id
       WHERE p.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  async findImagesByPostId(postId: string): Promise<BlogImageRow[]> {
    const result = await pool.query(
      `SELECT * FROM blog.images
       WHERE post_id = $1
       ORDER BY position_in_post ASC`,
      [postId]
    );
    return result.rows;
  }

  async findTagsByPostId(postId: string): Promise<BlogTagRow[]> {
    const result = await pool.query(
      `SELECT t.id, t.name, t.slug
       FROM blog.tags t
       JOIN blog.post_tags pt ON t.id = pt.tag_id
       WHERE pt.post_id = $1
       ORDER BY t.name`,
      [postId]
    );
    return result.rows;
  }

  async findAllCategories(): Promise<BlogCategoryRow[]> {
    const result = await pool.query(
      `SELECT * FROM blog.categories ORDER BY name`
    );
    return result.rows;
  }

  async findAllTags(): Promise<BlogTagRow[]> {
    const result = await pool.query(
      `SELECT * FROM blog.tags ORDER BY name`
    );
    return result.rows;
  }
}

export const blogRepository = new BlogRepository();
