# Quick Start Guide

## Prerequisites

1. **Node.js** (v18 or higher)
2. **Gemini API Key** - Get from https://aistudio.google.com/app/apikey
3. **Chrome Browser** (for the extension)

## Setup

### 1. Backend Setup

```bash
cd platform/backend

# Install dependencies
npm install

# Install Playwright browsers (required for crawling)
npx playwright install chromium

# Configure environment
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
```

### 2. Frontend Setup (Admin UI)

```bash
cd platform/frontend

# Install dependencies
npm install
```

### 3. Extension Setup

```bash
cd wakefit-copilot

# Install dependencies
npm install

# Build the extension
npm run build
```

## Running the Application

### Option 1: Run Everything (Recommended)

**Terminal 1 - Backend API:**
```bash
cd platform/backend
npm run dev
```
Server runs on: `http://localhost:3001`

**Terminal 2 - Frontend Admin UI:**
```bash
cd platform/frontend
npm run dev
```
Admin UI runs on: `http://localhost:5173` (or similar Vite port)

**Terminal 3 - Load Extension:**
1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `wakefit-copilot/dist` directory

### Option 2: CLI Crawl Only

Run a crawl directly without the server:

```bash
cd platform/backend
npm run crawl https://www.wakefit.co
```

This will:
- Use your `.env` file for the API key
- Generate a `SiteConfig` in `data/configs/wakefit.co.json`
- Show progress and results in the terminal

## Usage Workflow

### 1. Crawl a Website

**Via Admin UI:**
1. Open `http://localhost:5173`
2. Enter website URL (e.g., `https://www.wakefit.co`)
3. Enter Gemini API key (or it uses `.env` if backend has it)
4. Click "Start Crawl"
5. Watch progress in real-time

**Via CLI:**
```bash
cd platform/backend
npm run crawl https://www.wakefit.co
```

**Via API:**
```bash
curl -X POST http://localhost:3001/crawl \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.wakefit.co"}'
```

### 2. Use the Extension

1. Navigate to the crawled website (e.g., `https://www.wakefit.co`)
2. Click the extension icon in Chrome toolbar
3. The copilot panel opens
4. Ask questions like:
   - "Show me mattresses under ₹15,000"
   - "What are the dimensions of this bed?"
   - "Compare this product with similar ones"

## Troubleshooting

### Backend won't start
- Check if port 3001 is available: `lsof -i :3001`
- Verify `.env` file exists and has `GEMINI_API_KEY`

### Extension not working
- Rebuild: `cd wakefit-copilot && npm run build`
- Reload extension in `chrome://extensions/`
- Check browser console for errors (F12)

### Crawl fails
- Verify Gemini API key is valid
- Check network connectivity
- Review logs in `platform/backend/data/jobs.json`

## Project Structure

```
stealth/
├── platform/
│   ├── backend/          # Crawler API server
│   │   ├── src/
│   │   ├── data/         # Generated configs
│   │   └── .env          # Your API keys
│   └── frontend/          # Admin UI
│       └── src/
└── wakefit-copilot/      # Chrome extension
    ├── src/
    └── dist/             # Built extension (load this in Chrome)
```

## Next Steps

1. **Crawl wakefit.co**: `npm run crawl https://www.wakefit.co`
2. **Test extension**: Visit wakefit.co and use the copilot
3. **View config**: Check `platform/backend/data/configs/wakefit.co.json`
