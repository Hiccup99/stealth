import { render, h, type ComponentType } from 'preact'
import { createShadowHost } from './shadow-host'
import { scan } from './modules/page-scanner'
import { associateStore } from '@/store/associateStore'
import { pageStore } from '@/store/page-store'
import { requirementsStore } from '@/store/user-requirements-store'
import { loadSiteConfig, refreshSiteConfig, getSiteConfig } from '@/store/site-config-store'
import { getStatus as getCursorStatus } from './modules/ghost-cursor'
import * as perfMonitor from './modules/performance-monitor'

const TAG = '[Wakefit Copilot]'

// ── Debug helpers (exposed to window for console access) ────────────────────
if (typeof window !== 'undefined') {
  (window as any).__wakefitCopilot = {
    cursorStatus:      () => getCursorStatus(),
    pageData:          () => pageStore.getState().data,
    associate:         () => associateStore.getState(),
    performance:       () => perfMonitor.getSummary(),
    requirements:      () => requirementsStore.getState().requirements,
    clearRequirements: () => requirementsStore.getState().clearRequirements(),
    siteConfig:        () => getSiteConfig(),
    refreshConfig:     async () => {
      const cfg = await refreshSiteConfig()
      console.log(`${TAG} 🔄 SiteConfig refreshed:`, cfg ? `${Object.keys(cfg.elements).length} elements` : 'not found')
      return cfg
    },
  }
  console.log(`${TAG} 🔧 Debug helpers available: window.__wakefitCopilot`)
}

// Load persisted requirements as early as possible so LLM calls have context
requirementsStore.getState().load()

// Load SiteConfig in the background — resolves before first user interaction
loadSiteConfig().then(config => {
  if (config) {
    const urlCount = config.urlRegistry?.products?.length ?? 0
    const featureCount = Object.values(config.features ?? {}).flat().length
    const recipeCount = Object.keys(config.interactionRecipes ?? {}).length
    console.log(`${TAG} 🗺️  SiteConfig loaded for ${config.domain} (v${config.version})`)
    console.log(`${TAG}    Elements: ${Object.keys(config.elements).length}`)
    console.log(`${TAG}    URL Registry: ${urlCount} products, ${config.urlRegistry?.categories?.length ?? 0} categories`)
    console.log(`${TAG}    Features: ${featureCount}, Recipes: ${recipeCount}`)
    if (urlCount === 0) {
      console.warn(`${TAG} ⚠️  URL Registry is empty — product navigation will be disabled`)
    }
  } else {
    console.log(`${TAG} ℹ️  No remote SiteConfig — using built-in selectors`)
    console.warn(`${TAG} ⚠️  URL Registry not available — product navigation will be limited`)
  }
}).catch((err) => {
  console.warn(`${TAG} ⚠️  Failed to load SiteConfig:`, err)
  // Non-fatal — built-in selectors remain active
})

// ── Performance budget tracking ──────────────────────────────────────────────
const perfTimings = {
  scriptStart: performance.now(),
  shadowMount: 0,
  scanComplete: 0,
}

// ── Step 1: content script parsed & executing ──────────────────────────────
console.log(`${TAG} 🚀 content script loaded — url: ${location.href}`)

// Lazy import so Preact + component tree is not in the critical parse path
let App: ComponentType | null = null
async function loadApp(): Promise<ComponentType> {
  if (!App) ({ App } = await import('@/components/App'))
  return App
}

// ── Bootstrap ──────────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null

async function mount() {
  console.log(`${TAG} 🏗️  mount() called`)

  // ── Step 2: shadow DOM creation ──────────────────────────────────────────
  const shadowStart = performance.now()
  const host = createShadowHost()
  container = host.container
  perfTimings.shadowMount = performance.now() - shadowStart
  perfMonitor.recordShadowMount(perfTimings.shadowMount)
  console.log(`${TAG} 🌑 shadow host created (#wakefit-copilot-root) — shadow mode: closed (${perfTimings.shadowMount.toFixed(1)}ms)`)

  // ── Step 3: Preact app loaded & rendered (defer to idle) ─────────────────
  if ('requestIdleCallback' in window) {
    requestIdleCallback(async () => {
      const AppComponent = await loadApp()
      console.log(`${TAG} ⚛️  App component loaded, rendering into shadow container…`)
      render(h(AppComponent, null), container as HTMLElement)
      console.log(`${TAG} ✅ Preact render complete`)
    }, { timeout: 100 })
  } else {
    setTimeout(async () => {
      const AppComponent = await loadApp()
      render(h(AppComponent, null), container as HTMLElement)
    }, 0)
  }

  // ── Step 4: page scan (critical path, must be fast) ──────────────────────
  console.log(`${TAG} 🔬 running page scanner…`)
  pageStore.getState().setScanning(true)
  const scanStart = performance.now()
  const pageData = scan()
  perfTimings.scanComplete = performance.now() - scanStart
  perfMonitor.recordPageScan(perfTimings.scanComplete)
  pageStore.getState().setData(pageData)
  console.log(`${TAG} 📦 scan complete — pageType: ${pageData.pageType} (${perfTimings.scanComplete.toFixed(1)}ms)`, pageData)

  if (pageData.pageType === 'product') {
    associateStore.getState().activate()
    console.log(`${TAG} 🟢 associate store activated (phase: listening)`)
  } else {
    console.log(`${TAG} ℹ️  non-product page — associate stays idle (${location.pathname})`)
  }
}

// ── SPA navigation detection ───────────────────────────────────────────────

let lastUrl = location.href

function onNavigate(nextUrl: string) {
  if (nextUrl === lastUrl) return
  console.log(`${TAG} 🔀 SPA navigation detected: ${lastUrl} → ${nextUrl}`)
  // Capture previous product name before wiping the store, so the new
  // CopilotPanel can show "I see you've moved on to {newProduct}…"
  const prevName = pageStore.getState().data?.product?.name ?? null
  lastUrl = nextUrl
  pageStore.getState().clear()
  if (prevName) pageStore.getState().setNavigatedFrom(prevName)
  associateStore.getState().deactivate()
  mount()
}

function patchHistory() {
  const wrap = (original: typeof history.pushState, method: string) =>
    function (this: History, ...args: Parameters<typeof history.pushState>) {
      console.log(`${TAG} 📍 history.${method}() intercepted — new url: ${args[2] ?? location.href}`)
      original.apply(this, args)
      window.dispatchEvent(new Event('wf:urlchange'))
    }

  history.pushState    = wrap(history.pushState,    'pushState')
  history.replaceState = wrap(history.replaceState, 'replaceState')

  window.addEventListener('popstate', () => {
    console.log(`${TAG} ⬅️  popstate fired — url: ${location.href}`)
    window.dispatchEvent(new Event('wf:urlchange'))
  })

  window.addEventListener('wf:urlchange', () => onNavigate(location.href))
  console.log(`${TAG} 🔧 history.pushState/replaceState patched for SPA detection`)
}

function watchBodyMutations() {
  let debounce: ReturnType<typeof setTimeout>

  const observer = new MutationObserver(() => {
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      if (location.href !== lastUrl) {
        console.log(`${TAG} 👀 MutationObserver detected URL drift — triggering navigate`)
        onNavigate(location.href)
      }
    }, 300)
  })

  observer.observe(document.body, { childList: true, subtree: false })
  console.log(`${TAG} 👁️  MutationObserver watching <body> direct children`)
}

// ── Entry point ───────────────────────────────────────────────────────────

function init() {
  const initTime = performance.now() - perfTimings.scriptStart
  console.log(`${TAG} ⚙️  init() — readyState: ${document.readyState} (${initTime.toFixed(1)}ms since script start)`)
  perfMonitor.recordScriptInjection(initTime)

  patchHistory()
  watchBodyMutations()
  
  // Defer mount to next frame to avoid blocking
  requestAnimationFrame(() => {
    requestAnimationFrame(mount) // Double RAF to ensure DOM is ready
  })
}

// ── Step 0: decide when to init ───────────────────────────────────────────
if (document.readyState === 'loading') {
  console.log(`${TAG} ⏳ document still loading — deferring init to DOMContentLoaded`)
  document.addEventListener('DOMContentLoaded', init, { once: true })
} else {
  console.log(`${TAG} ✔️  document already ready — calling init() immediately`)
  init()
}
