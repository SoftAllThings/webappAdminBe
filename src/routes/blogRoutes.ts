import { Router } from "express";
import { blogController } from "../controllers/blogController";

const router = Router();

// GET /api/blog/posts - List posts with pagination and filters
router.get("/posts", blogController.getPosts.bind(blogController));

// GET /api/blog/categories - List all categories
router.get("/categories", blogController.getCategories.bind(blogController));

// GET /api/blog/tags - List all tags
router.get("/tags", blogController.getTags.bind(blogController));

// GET /api/blog/posts/:id - Get single post with images and tags
router.get("/posts/:id", blogController.getPostById.bind(blogController));

// PUT /api/blog/posts/:id/logged - Update post logged status
router.put("/posts/:id/logged", blogController.updatePostLoggedStatus.bind(blogController));

export default router;
