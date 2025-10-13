# PoopCheck Admin Backend

## Security Configuration

### Environment Variables Setup

**IMPORTANT:** Never commit sensitive credentials to GitHub. Set these environment variables directly in your deployment platform (Render, Railway, etc.):

#### Required Environment Variables:

```bash
# Authentication (REQUIRED)
JWT_SECRET=your-super-secret-jwt-key-here-make-it-long-and-random
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password-here

# Database Configuration
DB_HOST=your-database-host
DB_PORT=6543
DB_NAME=postgres
DB_USER=your-database-user
DB_PASSWORD=your-database-password
DB_SSL=true
DB_MAX_CONNECTIONS=5
DB_IDLE_TIMEOUT=300000
DB_CONNECTION_TIMEOUT=60000

# Server Configuration
NODE_ENV=production
PORT=10000
FRONTEND_URL=https://your-frontend-domain.com
```

### Render.com Setup

1. Go to your Render Dashboard
2. Select your web service
3. Go to "Environment" tab
4. Add each environment variable manually
5. **Never put credentials in `render.yaml`**

### Local Development

1. Copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env
   ```

2. Fill in your actual credentials in `.env`

3. The `.env` file is automatically ignored by git

### Security Best Practices

- ✅ Use strong, random JWT secrets (32+ characters)
- ✅ Use secure passwords with special characters
- ✅ Set environment variables in deployment dashboard
- ✅ Never commit `.env` files to GitHub
- ❌ Never put credentials in YAML/config files that are committed

## Current Credentials (FOR REFERENCE ONLY)

**Username:** `admin`  
**Password:** `B0nQHfEb5jy5`

> **Note:** Change these in production for better security!
