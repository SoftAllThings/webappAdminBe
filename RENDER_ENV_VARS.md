# Environment Variables for Render Deployment

## Security Note

For production deployment, it's recommended to set these environment variables through Render's dashboard instead of committing them to the repository.

## Database Environment Variables Required:

### Core Database Connection

- `DB_HOST`: aws-1-us-west-1.pooler.supabase.com
- `DB_PORT`: 5432
- `DB_NAME`: postgres
- `DB_USER`: postgres.fyakhccoblsnkgtacgxk
- `DB_PASSWORD`: E7KawT7MDbdcAEr4F3PS
- `DB_SSL`: true

### Database Pool Configuration

- `DB_MAX_CONNECTIONS`: 5
- `DB_IDLE_TIMEOUT`: 300000 (5 min — don't evict warm pooler connections)
- `DB_CONNECTION_TIMEOUT`: 10000 (cold connects through Supavisor take ~4s)
- `DB_QUERY_TIMEOUT`: 30000

### Application Configuration

- `NODE_ENV`: production
- `PORT`: 10000 (Render uses port 10000 by default)
- `FRONTEND_URL`: [Your React app URL once deployed]

## How to Set Environment Variables in Render:

1. Go to your Render dashboard
2. Select your web service
3. Navigate to "Environment" tab
4. Add each environment variable individually
5. Deploy your service

## Alternative: Use render.yaml with fromSecret (Recommended)

For better security, you can store sensitive values as secrets in Render and reference them:

```yaml
envVars:
  - key: DB_PASSWORD
    fromSecret: database_password
  - key: DB_USER
    fromSecret: database_user
```

This approach keeps sensitive data out of your repository while still allowing automated deployments.
