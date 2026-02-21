import { findElement, findElementByUrl } from './element-finder'
import { moveTo, walkThrough, type MoveOptions } from './ghost-cursor'
import { addHighlight, clearHighlights } from '@/store/highlight-store'
import { requirementsStore, type UserRequirements } from '@/store/user-requirements-store'
import { getSiteConfig } from '@/store/site-config-store'
import type { InteractionRecipe, RecipeStep } from '@/types/site-config'

// ── Action types ─────────────────────────────────────────────────────────────

export type AgentAction =
  | { type: 'scroll_to';       target: string;   label?: string }
  | { type: 'highlight';       target: string;   label?: string;  color?: string }
  | { type: 'walk_through';    targets: string[]; speed?: MoveOptions['speed'] }
  | { type: 'compare';         items: Array<{ target: string; label?: string }> }
  | { type: 'read_aloud';      text: string }
  | { type: 'answer';          text: string }
  /** Navigate browser to a new page */
  | { type: 'navigate_to';     url: string;      label?: string }
  /** Ghost cursor walks to a product card on the page then navigates */
  | { type: 'open_product';    url: string;      label?: string }
  /** Silently update the user requirements store — no visual output */
  | { type: 'set_requirement'; key: string;      value: unknown }
  /** Emits a question + options back to the UI to render as choice chips */
  | { type: 'ask_question';    question: string; options?: string[] }

export interface ActionResult {
  /** Was the action completed successfully? */
  ok:      boolean
  /** For "answer" / "read_aloud" — the text payload (for the UI to display) */
  text?:   string
  /** Human-readable reason when ok = false */
  reason?: string
  /** True if element was not found (triggers graceful fallback message) */
  elementNotFound?: boolean
  /** Returned by ask_question — the question and options to surface in UI */
  question?: { text: string; options?: string[] }
  /** True if the action will trigger a page navigation (so UI can prepare) */
  navigating?: boolean
}

// ── Colour palette for comparison mode ──────────────────────────────────────

const COMPARE_PALETTE = [
  '#5B2D8E', // brand purple
  '#0ea5e9', // sky blue
  '#16a34a', // green
  '#ea580c', // orange
]

const TAG = '[Wakefit Copilot · action-executor]'

// ── Helpers ───────────────────────────────────────────────────────────────────

function notFound(target: string): ActionResult {
  console.warn(`${TAG} element not found for target: "${target}"`)
  return { ok: false, elementNotFound: true, reason: `Could not find element for "${target}" on this page.` }
}

/**
 * Apply a filter using the interaction recipe if available, otherwise fall back to URL params.
 */
async function applyFilter(key: string, value: unknown): Promise<boolean> {
  const config = getSiteConfig()

  // Try to find a matching recipe
  if (config?.interactionRecipes) {
    const recipeId = findRecipeForFilter(key, config)
    if (recipeId && config.interactionRecipes[recipeId]) {
      const recipe = config.interactionRecipes[recipeId]
      console.debug(`${TAG} executing recipe "${recipeId}" for ${key}`)
      return executeRecipe(recipe, { value, key })
    }
  }

  // Fallback: URL-based price filter
  if (key === 'minPrice' || key === 'maxPrice' || key === 'budget') {
    return applyPriceFilterUrl()
  }

  return false
}

function findRecipeForFilter(key: string, config: NonNullable<ReturnType<typeof getSiteConfig>>): string | null {
  if (!config.features) return null

  for (const [, feats] of Object.entries(config.features)) {
    if (!feats) continue
    for (const f of feats) {
      if (f.recipeId && (f.id === key || f.name.toLowerCase().includes(key.toLowerCase()))) {
        return f.recipeId
      }
    }
  }
  return null
}

async function executeRecipe(recipe: InteractionRecipe, vars: Record<string, unknown>): Promise<boolean> {
  for (const step of recipe.steps) {
    try {
      const ok = await executeRecipeStep(step, vars)
      if (!ok) return false
    } catch (err) {
      console.warn(`${TAG} recipe step failed:`, step, err)
      return false
    }
  }
  return true
}

async function executeRecipeStep(step: RecipeStep, vars: Record<string, unknown>): Promise<boolean> {
  switch (step.action) {
    case 'navigate': {
      window.location.href = interpolate(step.url, vars)
      return true
    }
    case 'click': {
      const el = document.querySelector<HTMLElement>(interpolate(step.selector, vars))
      if (!el) return false
      el.click()
      return true
    }
    case 'url_param': {
      const url = new URL(window.location.href)
      const val = step.template
        ? interpolate(step.template, vars)
        : String(vars.value ?? step.value)
      url.searchParams.set(step.key, val)
      console.debug(`${TAG} url_param: ${step.key}=${val}`)
      await new Promise(r => setTimeout(r, 300))
      window.location.href = url.toString()
      return true
    }
    case 'input': {
      const el = document.querySelector<HTMLInputElement>(interpolate(step.selector, vars))
      if (!el) return false
      el.value = String(vars.value ?? step.value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }
    case 'scroll': {
      window.scrollBy({ top: step.direction === 'down' ? (step.amount ?? 600) : -(step.amount ?? 600), behavior: 'smooth' })
      return true
    }
    case 'wait': {
      await new Promise(r => setTimeout(r, step.ms))
      return true
    }
  }
}

function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ''))
}

async function applyPriceFilterUrl(): Promise<boolean> {
  const { budget } = requirementsStore.getState().requirements
  const minPrice = budget?.min
  const maxPrice = budget?.max
  if (minPrice === undefined && maxPrice === undefined) return false

  try {
    const url = new URL(window.location.href)
    let existingMin: number | undefined
    let existingMax: number | undefined
    
    const existingRange = url.searchParams.get('priceRange')
    if (existingRange) {
      const match = existingRange.match(/\[(\d+),(\d+)\]/)
      if (match) {
        existingMin = Number(match[1])
        existingMax = Number(match[2])
      }
    }

    const finalMin = minPrice ?? existingMin ?? 0
    const finalMax = maxPrice ?? existingMax ?? 999999
    url.searchParams.set('priceRange', `[${finalMin},${finalMax}]`)
    
    const newUrl = url.toString()
    console.debug(`${TAG} applyPriceFilter: ${newUrl}`)
    await new Promise(r => setTimeout(r, 400))
    window.location.href = newUrl
    return true
  } catch (err) {
    console.warn(`${TAG} applyPriceFilter failed:`, err)
    return false
  }
}

/**
 * Resolve a product URL by looking it up in the URL registry.
 * STRICT MODE: Only returns URLs that exist in the registry.
 * Returns null if no match is found (caller should reject the action).
 */
function resolveProductUrl(url: string, label?: string): { url: string; matched: boolean } | null {
  const config = getSiteConfig()
  if (!config?.urlRegistry?.products?.length) {
    console.warn(`${TAG} resolveProductUrl: No URL registry available — cannot validate "${url}"`)
    return null // Strict: reject if no registry
  }

  try {
    const given = new URL(url)
    const givenPath = given.pathname

    // 1. Exact pathname match (ignoring query params and hash)
    const exact = config.urlRegistry.products.find(p => {
      try {
        const pPath = new URL(p.url).pathname
        return pPath === givenPath || p.url === url
      } catch { return false }
    })
    if (exact) {
      console.debug(`${TAG} resolveProductUrl: exact match "${url}" → "${exact.url}"`)
      return { url: exact.url, matched: true }
    }

    // 2. Partial path match (last segment or slug)
    const givenSlug = givenPath.split('/').filter(Boolean).pop()?.toLowerCase() ?? ''
    if (givenSlug && givenSlug.length > 5) {
      const partial = config.urlRegistry.products.find(p => {
        try {
          const pPath = new URL(p.url).pathname.toLowerCase()
          return pPath.includes(givenSlug) || pPath.endsWith(`/${givenSlug}`)
        } catch { return false }
      })
      if (partial) {
        console.debug(`${TAG} resolveProductUrl: partial match "${url}" → "${partial.url}"`)
        return { url: partial.url, matched: true }
      }
    }

    // 3. Name-based match (use the label to find the right product)
    if (label) {
      const labelLower = label.toLowerCase()
      const nameMatch = config.urlRegistry.products.find(p =>
        p.name.toLowerCase().includes(labelLower) || labelLower.includes(p.name.toLowerCase())
      )
      if (nameMatch) {
        console.debug(`${TAG} resolveProductUrl: name match "${label}" → "${nameMatch.url}"`)
        return { url: nameMatch.url, matched: true }
      }

      // Fuzzy: match on significant words
      const words = labelLower.split(/\s+/).filter(w => w.length > 3)
      if (words.length > 0) {
        const fuzzy = config.urlRegistry.products.find(p => {
          const pLower = p.name.toLowerCase()
          return words.filter(w => pLower.includes(w)).length >= Math.ceil(words.length * 0.5)
        })
        if (fuzzy) {
          console.debug(`${TAG} resolveProductUrl: fuzzy match "${label}" → "${fuzzy.url}"`)
          return { url: fuzzy.url, matched: true }
        }
      }
    }

    // STRICT: No match found — reject
    console.warn(`${TAG} resolveProductUrl: URL "${url}" not found in registry (${config.urlRegistry.products.length} products available)`)
    return null
  } catch (err) {
    console.warn(`${TAG} resolveProductUrl: Invalid URL format "${url}":`, err)
    return null
  }
}

// ── Core dispatcher ───────────────────────────────────────────────────────────

export async function executeAction(action: AgentAction): Promise<ActionResult> {
  console.debug(`${TAG} executing action:`, action)
  const actionStart = performance.now()

  switch (action.type) {

    // ── scroll_to ────────────────────────────────────────────────────────────
    // Move the ghost cursor to the target element, highlighting it on arrival.
    case 'scroll_to': {
      const el = findElement(action.target)
      if (!el) {
        console.warn(`${TAG} scroll_to failed: element not found for "${action.target}"`)
        return notFound(action.target)
      }
      console.debug(`${TAG} scroll_to: found element`, el, `(${el.offsetWidth}x${el.offsetHeight})`)
      await moveTo(el, {
        highlight: true,
        label:     action.label,
        speed:     'normal',
      })
      console.debug(`${TAG} scroll_to completed in ${(performance.now() - actionStart).toFixed(1)}ms`)
      return { ok: true }
    }

    // ── highlight ────────────────────────────────────────────────────────────
    // Cursor moves to the element AND a persistent overlay box is added to the
    // highlight store (so it stays visible after the cursor moves on).
    // For images, also attempts to open/expand the gallery if it's a thumbnail.
    case 'highlight': {
      const el = findElement(action.target)
      if (!el) {
        console.warn(`${TAG} highlight failed: element not found for "${action.target}"`)
        return notFound(action.target)
      }
      console.debug(`${TAG} highlight: found element`, el, `(${el.offsetWidth}x${el.offsetHeight})`)

      await moveTo(el, {
        highlight: false,  // We manage the highlight ourselves below
        speed:     'normal',
      })

      // Special handling for images: try to open/expand gallery if it's a thumbnail
      if (action.target === 'images' || action.target.includes('image') || action.target.includes('gallery')) {
        console.debug(`${TAG} image target detected, attempting to open gallery`)
        
        // Strategy 1: Look for clickable elements that might open a lightbox/modal
        const clickable = el.querySelector<HTMLElement>('button, [role="button"], a, [onclick], [class*="open"], [class*="expand"], [class*="zoom"], [class*="lightbox"]')
        if (clickable && clickable.offsetWidth > 0 && clickable.offsetHeight > 0) {
          console.debug(`${TAG} found clickable element:`, clickable)
          try {
            clickable.click()
            await new Promise(resolve => setTimeout(resolve, 500))
            console.debug(`${TAG} clicked gallery opener`)
          } catch (err) {
            console.warn(`${TAG} failed to click gallery opener:`, err)
          }
        } else {
          // Strategy 2: Try clicking the first image if it's small (likely a thumbnail)
          const img = el.querySelector<HTMLImageElement>('img') ?? el as HTMLImageElement
          if (img instanceof HTMLImageElement) {
            const isThumbnail = img.offsetWidth < 500 && img.offsetHeight < 500
            console.debug(`${TAG} found image: ${img.offsetWidth}x${img.offsetHeight} (thumbnail: ${isThumbnail})`)
            if (isThumbnail) {
              try {
                img.click()
                await new Promise(resolve => setTimeout(resolve, 500))
                console.debug(`${TAG} clicked thumbnail image`)
              } catch (err) {
                console.warn(`${TAG} failed to click image:`, err)
              }
            }
          }
        }
      }

      addHighlight({
        id:      `hl-${action.target.replace(/\s+/g, '-')}`,
        element: el,
        label:   action.label,
        color:   action.color,
      })

      console.debug(`${TAG} highlight completed in ${(performance.now() - actionStart).toFixed(1)}ms`)
      return { ok: true }
    }

    // ── walk_through ─────────────────────────────────────────────────────────
    // Guided tour: the cursor visits each target in sequence with step counter.
    case 'walk_through': {
      const pairs = action.targets.map(t => ({ target: t, el: findElement(t) }))
      const missing = pairs.filter(p => !p.el).map(p => p.target)

      if (missing.length > 0) {
        console.warn(`${TAG} walk_through: skipping missing targets:`, missing)
      }

      const elements = pairs.map(p => p.el).filter((el): el is HTMLElement => el !== null)
      if (elements.length === 0) {
        return { ok: false, elementNotFound: true, reason: 'None of the walk_through targets were found on this page.' }
      }

      await walkThrough(elements, { speed: action.speed ?? 'normal' })
      return { ok: true }
    }

    // ── compare ──────────────────────────────────────────────────────────────
    // Highlight multiple elements simultaneously with distinct colours.
    // The ghost cursor visits each one in sequence, then all highlights stay.
    case 'compare': {
      clearHighlights()

      const resolved = action.items.map((item, i) => ({
        ...item,
        el:    findElement(item.target),
        color: COMPARE_PALETTE[i % COMPARE_PALETTE.length],
      }))

      const missing = resolved.filter(r => !r.el).map(r => r.target)
      if (missing.length > 0) {
        console.warn(`${TAG} compare: skipping missing targets:`, missing)
      }

      const found = resolved.filter((r): r is typeof r & { el: HTMLElement } => r.el !== null)
      if (found.length < 2) {
        return { ok: false, elementNotFound: true, reason: 'Need at least 2 visible elements to compare.' }
      }

      // Visit each element with the cursor, adding a persistent highlight
      for (const { el, label, color } of found) {
        await moveTo(el, { highlight: false, speed: 'fast' })
        addHighlight({ id: `cmp-${label ?? color}`, element: el, label, color })
      }

      // Dim all but the first after the tour (optional visual cue)
      // (caller can drive dimming via updateHighlight if desired)
      return { ok: true }
    }

    // ── read_aloud ───────────────────────────────────────────────────────────
    // Future: TTS via the Web Speech API or chrome.tts.
    // For now, resolve immediately and let the UI handle text display.
    case 'read_aloud': {
      console.debug(`${TAG} read_aloud (stub): "${action.text.slice(0, 60)}…"`)

      if ('speechSynthesis' in window) {
        const utt = new SpeechSynthesisUtterance(action.text)
        utt.rate   = 1.0
        utt.lang   = 'en-IN'  // Wakefit's primary market
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(utt)
      }

      return { ok: true, text: action.text }
    }

    // ── answer ───────────────────────────────────────────────────────────────
    // Plain-text response — no DOM interaction. The text payload is returned
    // for the chat UI to display in a ChatBubble.
    case 'answer': {
      return { ok: true, text: action.text }
    }

    // ── navigate_to ─────────────────────────────────────────────────────────
    // Navigate the browser to a new URL (category page, product, etc.)
    // A short delay gives the UI a chance to show the message first.
    case 'navigate_to': {
      const url = action.url
      if (!url || typeof url !== 'string') {
        return { ok: false, reason: 'navigate_to: missing or invalid url' }
      }
      console.debug(`${TAG} navigate_to: "${url}" (label: ${action.label ?? 'none'})`)
      setTimeout(() => { window.location.href = url }, 400)
      return { ok: true, navigating: true }
    }

    // ── open_product ─────────────────────────────────────────────────────────
    // STRICT: Only navigates to URLs that exist in the URL registry.
    case 'open_product': {
      const url = action.url
      if (!url || typeof url !== 'string') {
        return { ok: false, reason: 'open_product: missing or invalid url' }
      }

      // STRICT validation: must exist in URL registry
      const resolved = resolveProductUrl(url, action.label)
      if (!resolved) {
        const config = getSiteConfig()
        const registrySize = config?.urlRegistry?.products?.length ?? 0
        console.error(`${TAG} open_product: REJECTED — URL "${url}" not found in registry`)
        return {
          ok: false,
          reason: `Product URL not found. The URL "${url}" doesn't exist in our catalog. ${registrySize > 0 ? `Please use a URL from the product list.` : 'URL registry not loaded.'}`,
          elementNotFound: true,
        }
      }

      const resolvedUrl = resolved.url
      if (resolved.matched && resolvedUrl !== url) {
        console.debug(`${TAG} open_product: resolved "${url}" → "${resolvedUrl}"`)
      }
      
      console.debug(`${TAG} open_product: navigating to "${resolvedUrl}" (label: ${action.label ?? 'none'})`)

      // Try to find the product card for visual cursor animation
      const card = findElementByUrl(resolvedUrl) ?? findElementByUrl(url)
      if (card) {
        await moveTo(card, { highlight: true, label: action.label, speed: 'fast' })
        addHighlight({ id: 'open-product', element: card, label: action.label })
        await new Promise(r => setTimeout(r, 600))
      }

      window.location.href = resolvedUrl
      return { ok: true, navigating: true }
    }

    // ── set_requirement ──────────────────────────────────────────────────────
    // Store a user preference AND interact with the UI if it's a filter-related requirement.
    case 'set_requirement': {
      const { key, value } = action
      if (!key || typeof key !== 'string') {
        return { ok: false, reason: 'set_requirement: missing key' }
      }
      console.debug(`${TAG} set_requirement: ${key} =`, value)
      try {
        // Map minPrice/maxPrice to budget object structure
        if (key === 'minPrice' || key === 'maxPrice') {
          const current = requirementsStore.getState().requirements.budget || {}
          const budget = {
            ...current,
            [key === 'minPrice' ? 'min' : 'max']: typeof value === 'number' ? value : Number(value),
          }
          requirementsStore.getState().setRequirement('budget', budget)
        } else {
          requirementsStore.getState().setRequirement(
            key as keyof UserRequirements,
            value as UserRequirements[keyof UserRequirements],
          )
        }

        // Execute the matching interaction recipe or fallback to URL params
        if (key === 'minPrice' || key === 'maxPrice' || key === 'budget') {
          const applied = await applyFilter(key, value)
          if (!applied) {
            console.warn(`${TAG} set_requirement: stored ${key} but couldn't apply filter`)
          }
        }

        return { ok: true }
      } catch (err) {
        console.warn(`${TAG} set_requirement failed:`, err)
        return { ok: false, reason: `set_requirement: ${err}` }
      }
    }

    // ── ask_question ─────────────────────────────────────────────────────────
    // Returns the question+options back to the UI to render as choice chips.
    // No cursor movement — purely a UI directive.
    case 'ask_question': {
      console.debug(`${TAG} ask_question: "${action.question}"`)
      return {
        ok:       true,
        question: { text: action.question, options: action.options },
      }
    }
  }
}

// ── Batch executor ────────────────────────────────────────────────────────────

/**
 * Execute a list of actions in sequence.
 * Stops on the first hard failure unless `continueOnError` is set.
 */
export async function executeActions(
  actions: AgentAction[],
  options: { continueOnError?: boolean } = {},
): Promise<ActionResult[]> {
  const results: ActionResult[] = []

  for (const action of actions) {
    const result = await executeAction(action)
    results.push(result)

    if (!result.ok && !options.continueOnError) {
      console.warn(`${TAG} batch stopped after failed action:`, action, result.reason)
      break
    }
  }

  return results
}
