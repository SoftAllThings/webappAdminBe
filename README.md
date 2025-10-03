# WebApp Admin Backend

A Node.js Express backend API with PostgreSQL database integration for the WebApp Admin application.

## Features

- **Express.js** - Fast, unopinionated web framework
- **TypeScript** - Type-safe JavaScript development
- **PostgreSQL** - Robust relational database
- **Security** - Helmet.js for security headers
- **CORS** - Cross-origin resource sharing support
- **Logging** - Morgan for HTTP request logging
- **Environment Configuration** - dotenv for environment variables

## Project Structure

```
src/
├── config/          # Database and other configurations
├── controllers/     # Route controllers
├── middleware/      # Custom middleware
├── models/         # Database models
├── routes/         # API routes
└── utils/          # Utility functions
```

## Prerequisites

- Node.js (v16 or higher)
- PostgreSQL database
- npm or yarn

## Setup

1. **Clone and install dependencies:**

   ```bash
   npm install
   ```

2. **Set up environment variables:**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` file with your database credentials and other configuration.

3. **Set up PostgreSQL database:**
   - Create a PostgreSQL database
   - Update the database credentials in your `.env` file

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run start:dev` - Start development server with ts-node
- `npm run build` - Build the TypeScript code to JavaScript
- `npm start` - Start production server
- `npm run clean` - Remove build directory
- `npm run rebuild` - Clean and build

## Environment Variables

Copy `.env.example` to `.env` and configure the following variables:

| Variable       | Description           | Default                 |
| -------------- | --------------------- | ----------------------- |
| `NODE_ENV`     | Environment mode      | `development`           |
| `PORT`         | Server port           | `3001`                  |
| `FRONTEND_URL` | Frontend URL for CORS | `http://localhost:3000` |
| `DB_HOST`      | PostgreSQL host       | `localhost`             |
| `DB_PORT`      | PostgreSQL port       | `5432`                  |
| `DB_NAME`      | Database name         | `webappadmin`           |
| `DB_USER`      | Database username     | `postgres`              |
| `DB_PASSWORD`  | Database password     | -                       |

## API Endpoints

### Health Check

- `GET /` - Root endpoint
- `GET /api/health` - Health check endpoint
- `GET /api/info` - API information

## Development

Start the development server:

```bash
npm run dev
```

The server will start on `http://localhost:3001` (or the port specified in your `.env` file).

## Production

1. Build the application:

   ```bash
   npm run build
   ```

2. Start the production server:
   ```bash
   npm start
   ```

## Database

This backend uses PostgreSQL. Make sure you have:

1. PostgreSQL installed and running
2. A database created for the application
3. Proper credentials configured in your `.env` file

The application will test the database connection on startup.
