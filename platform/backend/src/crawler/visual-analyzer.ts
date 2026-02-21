/**
 * visual-analyzer.ts — Gemini Flash Vision client
 *
 * Takes Playwright screenshots and sends them to Gemini Flash Vision
 * for structured page analysis: classification, interactive elements,
 * and feature detection.
 */

import type { Page } from 'playwright'
import type { PageTypeKey, Feature, FeatureType, InteractionMethod } from '../shared-types'

const TAG = '[visual-analyzer]'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PageAnalysis {
  pageType: PageTypeKey
  confidence: number
  title: string
  interactiveElements: VisualElement[]
  description: string
}

export interface VisualElement {
  name: string
  type: FeatureType
  description: string
  interactionMethod: InteractionMethod
  options?: string[]
}

export interface FeatureAnalysis {
  features: Feature[]
  rawResponse: string
}

// ── Gemini Flash Vision API ──────────────────────────────────────────────────

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

async function callGeminiVision(
  apiKey: string,
  prompt: string,
  imageBase64: string,
  mimeType: string = 'image/png',
): Promise<string> {
  const url = `${GEMINI_API_BASE}/models/gemini-2.0-flash:generateContent?key=${apiKey}`

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
    },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gemini Vision API ${res.status}: ${text}`)
  }

  const data = await res.json()
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!content) throw new Error('Gemini Vision returned empty response')
  return content
}

// ── Screenshot helper ─────────────────────────────────────────────────────────

export async function takeScreenshot(page: Page): Promise<Buffer> {
  return page.screenshot({ fullPage: true, type: 'png' })
}

export async function takeViewportScreenshot(page: Page): Promise<Buffer> {
  return page.screenshot({ fullPage: false, type: 'png' })
}

// ── Page classification ───────────────────────────────────────────────────────

const CLASSIFY_PROMPT = `You are analyzing a screenshot of an e-commerce website page.

Classify this page and identify all interactive elements visible on screen.

Respond with a JSON object in this exact format:
{
  "pageType": "home" | "product" | "category" | "cart" | "search" | "other",
  "confidence": <number 0-100>,
  "title": "<page title visible on screen>",
  "description": "<1 sentence describing the page>",
  "interactiveElements": [
    {
      "name": "<element name, e.g. 'Price Range Filter'>",
      "type": "filter" | "sort" | "search" | "variant" | "cta" | "navigation" | "content" | "gallery",
      "description": "<what it does>",
      "interactionMethod": "url_param" | "click" | "input" | "select" | "none",
      "options": ["<option1>", "<option2>"]
    }
  ]
}

Classification rules:
- "home": Landing page with hero banners, featured categories, promotions
- "product": Single product detail page with add-to-cart, images, specs, price
- "category": Product listing/grid with multiple product cards, filters, sorting
- "cart": Shopping cart with line items, totals, checkout button
- "search": Search results page
- "other": Account, blog, policy, FAQ, etc.

For interactiveElements, identify ALL visible:
- Filters (price range, size, material, brand, color, etc.)
- Sort dropdowns (popularity, price low-high, newest, etc.)
- Search bars
- Variant pickers (size, color, material on PDP)
- CTA buttons (add to cart, buy now, wishlist, compare)
- Navigation elements (breadcrumbs, pagination, tabs)
- Content sections (reviews, specs, gallery, description)
- Image galleries

Be thorough — list every interactive element you can see.`

export async function classifyPageVisually(
  page: Page,
  apiKey: string,
  log: (msg: string) => void,
): Promise<PageAnalysis> {
  const screenshot = await takeViewportScreenshot(page)
  const base64 = screenshot.toString('base64')

  log(`${TAG} sending screenshot to Gemini Vision for classification...`)

  const response = await callGeminiVision(apiKey, CLASSIFY_PROMPT, base64)

  try {
    const parsed = JSON.parse(response)
    log(`${TAG} classified as: ${parsed.pageType} (${parsed.confidence}% confidence)`)
    log(`${TAG} found ${parsed.interactiveElements?.length ?? 0} interactive elements`)
    return {
      pageType: parsed.pageType ?? 'other',
      confidence: parsed.confidence ?? 50,
      title: parsed.title ?? '',
      description: parsed.description ?? '',
      interactiveElements: (parsed.interactiveElements ?? []).map((el: any) => ({
        name: el.name ?? '',
        type: el.type ?? 'content',
        description: el.description ?? '',
        interactionMethod: el.interactionMethod ?? 'none',
        options: el.options,
      })),
    }
  } catch (err) {
    log(`${TAG} failed to parse VLM response: ${(err as Error).message}`)
    log(`${TAG} raw response: ${response.slice(0, 200)}`)
    return {
      pageType: 'other',
      confidence: 0,
      title: '',
      description: '',
      interactiveElements: [],
    }
  }
}

// ── Feature detection (full-page, detailed) ──────────────────────────────────

const FEATURE_PROMPT = `You are analyzing a full-page screenshot of an e-commerce website.

Identify ALL interactive features on this page in detail. For each feature, determine:
1. What it is (filter, sort, variant picker, CTA, etc.)
2. How to interact with it (URL parameter, click, input field, dropdown)
3. What options/values are available

Respond with a JSON object:
{
  "features": [
    {
      "id": "<snake_case_id>",
      "name": "<human readable name>",
      "description": "<what this feature does>",
      "type": "filter" | "sort" | "search" | "variant" | "cta" | "navigation" | "content" | "gallery",
      "interactionMethod": "url_param" | "click" | "input" | "select" | "none",
      "options": [
        {"label": "<display text>", "value": "<value to use>"}
      ]
    }
  ]
}

Be exhaustive. Include:
- Every filter visible (price, size, material, brand, rating, etc.)
- Sort options with their values
- Size/color/variant pickers
- All CTA buttons (add to cart, buy now, wishlist, compare, share)
- Navigation elements (breadcrumbs, tabs, pagination, load more)
- Content sections (reviews, Q&A, specifications, description, gallery)
- Image gallery controls (thumbnails, zoom, arrows)
- EMI/payment options
- Delivery/pincode checkers

For filters that use URL parameters (common in modern SPAs), note that.
For filters that use DOM inputs (sliders, checkboxes), note that.`

export async function detectFeaturesVisually(
  page: Page,
  apiKey: string,
  pageType: PageTypeKey,
  log: (msg: string) => void,
): Promise<FeatureAnalysis> {
  const screenshot = await takeScreenshot(page)
  const base64 = screenshot.toString('base64')

  log(`${TAG} analyzing features for ${pageType} page...`)

  const contextPrompt = `${FEATURE_PROMPT}\n\nThis is a ${pageType} page. Focus on features typical for this page type.`
  const response = await callGeminiVision(apiKey, contextPrompt, base64)

  try {
    const parsed = JSON.parse(response)
    const features: Feature[] = (parsed.features ?? []).map((f: any, idx: number) => ({
      id: f.id || `${pageType}_feature_${idx}`,
      name: f.name ?? '',
      description: f.description ?? '',
      type: f.type ?? 'content',
      interactionMethod: f.interactionMethod ?? 'none',
      options: f.options?.map((o: any) => ({
        label: typeof o === 'string' ? o : o.label ?? '',
        value: typeof o === 'string' ? o : o.value ?? '',
      })),
    }))

    log(`${TAG} detected ${features.length} features on ${pageType} page`)
    return { features, rawResponse: response }
  } catch (err) {
    log(`${TAG} failed to parse feature response: ${(err as Error).message}`)
    return { features: [], rawResponse: response }
  }
}

// ── URL interaction detection ─────────────────────────────────────────────────

const URL_INTERACTION_PROMPT = `You are analyzing an e-commerce website page. I will show you the current URL and a screenshot.

Your task: determine how this website handles filtering and sorting.

Many modern e-commerce sites use URL query parameters for filters:
- Price: ?priceRange=[500,44000] or ?minPrice=500&maxPrice=44000
- Sort: ?sortBy=popularity or ?sort=price-asc
- Filters: ?filterIds=[706] or ?brand=wakefit

Look at the URL bar and the page content. Identify the URL parameter patterns.

Respond with JSON:
{
  "urlPatterns": {
    "priceFilter": {"param": "<param name>", "format": "<description of format>", "example": "<example value>"},
    "sort": {"param": "<param name>", "format": "<description>", "example": "<example>"},
    "filters": [{"param": "<param name>", "format": "<description>", "example": "<example>"}]
  },
  "usesUrlFiltering": true | false,
  "usesDomFiltering": true | false,
  "notes": "<any additional observations>"
}`

export async function analyzeUrlInteractions(
  page: Page,
  apiKey: string,
  currentUrl: string,
  log: (msg: string) => void,
): Promise<{ urlPatterns: any; usesUrlFiltering: boolean; usesDomFiltering: boolean }> {
  const screenshot = await takeViewportScreenshot(page)
  const base64 = screenshot.toString('base64')

  const prompt = `${URL_INTERACTION_PROMPT}\n\nCurrent URL: ${currentUrl}`
  log(`${TAG} analyzing URL interaction patterns...`)

  const response = await callGeminiVision(apiKey, prompt, base64)

  try {
    const parsed = JSON.parse(response)
    log(`${TAG} URL filtering: ${parsed.usesUrlFiltering}, DOM filtering: ${parsed.usesDomFiltering}`)
    return {
      urlPatterns: parsed.urlPatterns ?? {},
      usesUrlFiltering: parsed.usesUrlFiltering ?? false,
      usesDomFiltering: parsed.usesDomFiltering ?? false,
    }
  } catch {
    log(`${TAG} failed to parse URL interaction response`)
    return { urlPatterns: {}, usesUrlFiltering: false, usesDomFiltering: false }
  }
}
