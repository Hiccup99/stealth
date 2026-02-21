import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import crawlRouter from './routes/crawl'
import configRouter from './routes/config'

const app = express()
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({
  origin: [
    /chrome-extension:\/\//,   // Allow any Chrome extension
    /^https?:\/\/.*\.wakefit\.co$/,  // Allow wakefit.co and subdomains
    /^https?:\/\/wakefit\.co$/,      // Allow wakefit.co root
    'http://localhost:3000',    // Admin UI dev
    'http://localhost:5173',    // Vite dev
    /\.railway\.app$/,          // Railway production
    /\.render\.com$/,           // Render production
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}))

app.use(express.json({ limit: '10mb' }))

// ── Health check & root ───────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.redirect(302, '/health')
})

app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() })
})

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/crawl', crawlRouter)
app.use('/config', configRouter)

// ── 404 handler ───────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] 🚀 Platform API running on http://0.0.0.0:${PORT}`)
  console.log(`[server]    POST /crawl        — trigger a crawl`)
  console.log(`[server]    GET  /crawl/jobs   — list jobs`)
  console.log(`[server]    GET  /config/:domain — get SiteConfig`)
})

export default app
