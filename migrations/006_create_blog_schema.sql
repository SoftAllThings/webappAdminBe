-- Migration 006: Create blog schema and tables
-- Auto-generated gut health blog agent content management

CREATE SCHEMA IF NOT EXISTS blog;

-- Categories
CREATE TABLE IF NOT EXISTS blog.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(120) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tags
CREATE TABLE IF NOT EXISTS blog.tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(120) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Posts
CREATE TABLE IF NOT EXISTS blog.posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Core content
    title VARCHAR(300) NOT NULL,
    slug VARCHAR(350) NOT NULL UNIQUE,
    excerpt TEXT,
    content_html TEXT NOT NULL,
    content_text TEXT,

    -- Category
    category_id UUID REFERENCES blog.categories(id) ON DELETE SET NULL,

    -- SEO metadata
    meta_title VARCHAR(70),
    meta_description VARCHAR(160),
    target_keywords TEXT[],

    -- Social media snippets
    twitter_snippet VARCHAR(280),
    linkedin_snippet VARCHAR(700),

    -- Research context
    research_sources JSONB,
    topic_rationale TEXT,

    -- Internal linking
    related_post_ids UUID[],

    -- Publishing
    status VARCHAR(20) NOT NULL DEFAULT 'published'
        CHECK (status IN ('published', 'draft', 'archived')),
    published_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Logged status
    already_logged BOOLEAN DEFAULT FALSE,

    -- Agent metadata
    generation_model VARCHAR(50),
    generation_duration_ms INTEGER,
    pipeline_log JSONB,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Images
CREATE TABLE IF NOT EXISTS blog.images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES blog.posts(id) ON DELETE CASCADE,

    image_type VARCHAR(20) NOT NULL CHECK (image_type IN ('hero', 'inline')),
    s3_key VARCHAR(500) NOT NULL,
    s3_url VARCHAR(1000) NOT NULL,
    alt_text VARCHAR(300),
    caption TEXT,

    width INTEGER,
    height INTEGER,
    file_size_bytes INTEGER,
    mime_type VARCHAR(50) DEFAULT 'image/png',

    prompt_used TEXT,
    position_in_post INTEGER DEFAULT 0,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Post-Tags junction
CREATE TABLE IF NOT EXISTS blog.post_tags (
    post_id UUID NOT NULL REFERENCES blog.posts(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES blog.tags(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_posts_slug ON blog.posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_status ON blog.posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_published_at ON blog.posts(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_category ON blog.posts(category_id);
CREATE INDEX IF NOT EXISTS idx_images_post_id ON blog.images(post_id);
CREATE INDEX IF NOT EXISTS idx_post_tags_post ON blog.post_tags(post_id);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON blog.post_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON blog.categories(slug);
CREATE INDEX IF NOT EXISTS idx_tags_slug ON blog.tags(slug);

-- Full-text search
CREATE INDEX IF NOT EXISTS idx_posts_fulltext ON blog.posts
    USING gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content_text, '')));

-- Auto-update trigger for updated_at
CREATE OR REPLACE FUNCTION blog.update_posts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_posts_updated_at ON blog.posts;
CREATE TRIGGER trigger_posts_updated_at
    BEFORE UPDATE ON blog.posts
    FOR EACH ROW
    EXECUTE FUNCTION blog.update_posts_updated_at();

-- Seed default categories
INSERT INTO blog.categories (name, slug, description) VALUES
    ('Gut Health Basics', 'gut-health-basics', 'Foundational topics about gut health and digestive wellness'),
    ('Diet & Nutrition', 'diet-nutrition', 'How diet and nutrition impact gut health'),
    ('Digestive Conditions', 'digestive-conditions', 'Common digestive disorders and their management'),
    ('Microbiome Science', 'microbiome-science', 'Latest research on the gut microbiome'),
    ('Lifestyle & Wellness', 'lifestyle-wellness', 'Lifestyle factors affecting digestive health'),
    ('Research & News', 'research-news', 'Breaking news and latest studies in gut health')
ON CONFLICT (slug) DO NOTHING;
