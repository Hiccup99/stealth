# Copilot Platform Backend

Crawler backend for the Copilot Site Intelligence Platform. Uses screenshot-led ingestion with Gemini Flash Vision to build comprehensive site configurations.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add your Gemini API key:
   ```
   GEMINI_API_KEY=your_gemini_api_key_here
   PORT=3001
   ```

   Get your Gemini API key from: https://aistudio.google.com/app/apikey

3. **Build:**
   ```bash
   npm run build
   ```

## Usage

### CLI Crawl

Run a crawl directly from the command line:

```bash
# Using .env file (recommended)
npx tsx src/cli-crawl.ts https://www.wakefit.co

# Or pass API key as argument
npx tsx src/cli-crawl.ts https://www.wakefit.co YOUR_GEMINI_API_KEY
```

### HTTP Server

Start the API server:

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

The server runs on `http://localhost:3001` (or the port specified in `.env`).

**Endpoints:**
- `POST /crawl` - Trigger a crawl job
- `GET /crawl/jobs` - List all crawl jobs
- `GET /crawl/jobs/:jobId` - Get job status and logs
- `GET /config/:domain` - Get SiteConfig for a domain

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `GEMINI_API_KEY` | Gemini Flash Vision API key for VLM features | Yes (for VLM) | - |
| `PORT` | Server port | No | 3001 |

## API Key Resolution

The API key is resolved in this order:
1. Command-line argument (CLI only)
2. Request body `geminiApiKey` (API only)
3. `GEMINI_API_KEY` environment variable (from `.env` or system env)

If no API key is provided, the crawler runs in DOM-only mode (no VLM features).
