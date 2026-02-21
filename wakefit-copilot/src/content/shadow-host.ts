import tailwindStyles from './styles/index.css?inline'

export interface ShadowHost {
  /** The closed shadow root — pass this to Preact's render() */
  shadowRoot: ShadowRoot
  /** Inner container with pointer-events:auto for interactive UI */
  container: HTMLDivElement
}

/**
 * Creates an isolated shadow host on document.body.
 *
 * Layout:
 *   #wakefit-copilot-root  (fixed, full-viewport, pointer-events:none, z-index:max)
 *   └── shadow root (closed)
 *       ├── <style>  ← compiled Tailwind, fully scoped
 *       └── <div>    ← container (pointer-events:auto) → Preact renders here
 */
const TAG = '[Wakefit Copilot]'

export function createShadowHost(): ShadowHost {
  const existing = document.getElementById('wakefit-copilot-root')
  if (existing) {
    console.log(`${TAG} 🔄 existing shadow host found — removing before remount`)
    existing.remove()
  }

  const host = document.createElement('div')
  host.id = 'wakefit-copilot-root'

  // Batch all style writes
  host.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;pointer-events:none;border:none;margin:0;padding:0'

  // closed → host page JS cannot reach in via element.shadowRoot
  const shadowRoot = host.attachShadow({ mode: 'closed' })

  // Inject compiled Tailwind scoped entirely inside the shadow root
  const style = document.createElement('style')
  style.textContent = tailwindStyles
  shadowRoot.appendChild(style)

  // Interactive container — individual UI panels opt-in to receiving events
  const container = document.createElement('div')
  container.style.pointerEvents = 'auto'
  shadowRoot.appendChild(container)

  document.body.appendChild(host)
  console.log(`${TAG} 📌 #wakefit-copilot-root appended to <body>`)
  console.log(`${TAG} 🎨 Tailwind styles injected into shadow root (${style.textContent.length} chars)`)

  return { shadowRoot, container }
}
