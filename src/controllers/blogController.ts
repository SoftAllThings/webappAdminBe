import { Request, Response } from "express";
import { blogRepository } from "../repositories/blog.repository";

export class BlogController {
  async getPosts(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
      const offset = (page - 1) * limit;

      const category = req.query.category as string | undefined;
      const tag = req.query.tag as string | undefined;
      const search = req.query.search as string | undefined;

      const filters: { category?: string; tag?: string; search?: string } = {};
      if (category) filters.category = category;
      if (tag) filters.tag = tag;
      if (search) filters.search = search;

      const { rows: posts, total } = await blogRepository.findAllPosts(offset, limit, filters);

      // Fetch hero image and tags for each post
      const postsWithMeta = await Promise.all(
        posts.map(async (post) => {
          const [images, tags] = await Promise.all([
            blogRepository.findImagesByPostId(post.id),
            blogRepository.findTagsByPostId(post.id),
          ]);

          const heroImage = images.find((img) => img.image_type === "hero");

          return {
            id: post.id,
            title: post.title,
            slug: post.slug,
            excerpt: post.excerpt,
            category: post.category_id
              ? { id: post.category_id, name: post.category_name, slug: post.category_slug }
              : null,
            tags,
            hero_image_url: heroImage?.s3_url || null,
            published_at: post.published_at,
            meta_title: post.meta_title,
            target_keywords: post.target_keywords,
          };
        })
      );

      res.status(200).json({
        success: true,
        data: postsWithMeta,
        meta: { total, page, limit },
      });
    } catch (error) {
      console.error("Error in getPosts:", error);
      res.status(500).json({
        success: false,
        error: { message: "Failed to fetch blog posts" },
      });
    }
  }

  async getPostById(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id;
      if (!id) {
        res.status(400).json({ success: false, error: { message: "Missing post ID" } });
        return;
      }

      const post = await blogRepository.findPostById(id);
      if (!post) {
        res.status(404).json({
          success: false,
          error: { message: "Blog post not found" },
        });
        return;
      }

      const [images, tags] = await Promise.all([
        blogRepository.findImagesByPostId(id),
        blogRepository.findTagsByPostId(id),
      ]);

      res.status(200).json({
        success: true,
        data: {
          ...post,
          category: post.category_id
            ? { id: post.category_id, name: post.category_name, slug: post.category_slug }
            : null,
          images,
          tags,
        },
      });
    } catch (error) {
      console.error("Error in getPostById:", error);
      res.status(500).json({
        success: false,
        error: { message: "Failed to fetch blog post" },
      });
    }
  }

  async getCategories(req: Request, res: Response): Promise<void> {
    try {
      const categories = await blogRepository.findAllCategories();
      res.status(200).json({ success: true, data: categories });
    } catch (error) {
      console.error("Error in getCategories:", error);
      res.status(500).json({
        success: false,
        error: { message: "Failed to fetch categories" },
      });
    }
  }

  async getTags(req: Request, res: Response): Promise<void> {
    try {
      const tags = await blogRepository.findAllTags();
      res.status(200).json({ success: true, data: tags });
    } catch (error) {
      console.error("Error in getTags:", error);
      res.status(500).json({
        success: false,
        error: { message: "Failed to fetch tags" },
      });
    }
  }
}

export const blogController = new BlogController();
