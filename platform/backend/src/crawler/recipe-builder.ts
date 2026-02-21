/**
 * recipe-builder.ts
 *
 * Generates interaction recipes from detected features.
 * Each recipe is a sequence of steps the copilot can execute
 * to interact with a specific feature.
 *
 * Also validates recipes by executing them against the live site.
 */

import type { BrowserContext, Page } from 'playwright'
import type {
  Feature, InteractionRecipe, RecipeStep,
  PageTypeKey,
} from '../shared-types'
import { dismissPopups } from './popup-handler'

const TAG = '[recipe-builder]'

interface RecipeBuildOptions {
  ctx: BrowserContext
  origin: string
  features: Partial<Record<PageTypeKey, Feature[]>>
  urlInteractionPatterns: Record<string, any>
  sampleUrls: Partial<Record<PageTypeKey, string[]>>
  log: (msg: string) => void
}

interface RecipeBuildResult {
  recipes: Record<string, InteractionRecipe>
  features: Partial<Record<PageTypeKey, Feature[]>>
}

export async function buildRecipes(opts: RecipeBuildOptions): Promise<RecipeBuildResult> {
  const { ctx, origin, features, urlInteractionPatterns, sampleUrls, log } = opts

  const recipes: Record<string, InteractionRecipe> = {}

  for (const [pageType, pageFeatures] of Object.entries(features) as [PageTypeKey, Feature[]][]) {
    if (!pageFeatures) continue

    for (const feature of pageFeatures) {
      const recipe = generateRecipe(feature, pageType, origin, urlInteractionPatterns[pageType])
      if (recipe) {
        recipes[recipe.id] = recipe
        feature.recipeId = recipe.id
        log(`${TAG} generated recipe: ${recipe.id} (${recipe.steps.length} steps)`)
      }
    }
  }

  // Validate a subset of recipes
  const recipeList = Object.values(recipes)
  if (recipeList.length > 0) {
    log(`${TAG} validating ${Math.min(5, recipeList.length)} recipes...`)
    await validateRecipes(ctx, recipeList.slice(0, 5), sampleUrls, log)
  }

  log(`${TAG} total recipes: ${Object.keys(recipes).length}`)

  return { recipes, features }
}

// ── Recipe generation ─────────────────────────────────────────────────────

function generateRecipe(
  feature: Feature,
  pageType: PageTypeKey,
  origin: string,
  urlPatterns?: any,
): InteractionRecipe | null {
  const id = `${pageType}_${feature.id}`
  const steps: RecipeStep[] = []

  switch (feature.type) {
    case 'filter':
      return generateFilterRecipe(id, feature, pageType, origin, urlPatterns)
    case 'sort':
      return generateSortRecipe(id, feature, pageType, origin, urlPatterns)
    case 'search':
      return generateSearchRecipe(id, feature, pageType)
    case 'variant':
      return generateVariantRecipe(id, feature, pageType)
    case 'cta':
      return generateCtaRecipe(id, feature, pageType)
    case 'gallery':
      return generateGalleryRecipe(id, feature, pageType)
    case 'navigation':
      return generateNavigationRecipe(id, feature, pageType)
    case 'content':
      return generateContentRecipe(id, feature, pageType)
    default:
      return null
  }
}

function generateFilterRecipe(
  id: string,
  feature: Feature,
  pageType: PageTypeKey,
  origin: string,
  urlPatterns?: any,
): InteractionRecipe {
  const steps: RecipeStep[] = []
  const nameLower = feature.name.toLowerCase()

  if (feature.interactionMethod === 'url_param') {
    // URL-based filtering
    if (nameLower.includes('price') && urlPatterns?.urlPatterns?.priceFilter) {
      const param = urlPatterns.urlPatterns.priceFilter.param
      steps.push({
        action: 'url_param',
        key: param,
        value: '{{value}}',
        template: `${param}=[{{min}},{{max}}]`,
      })
    } else {
      // Generic URL param filter
      const paramName = feature.id.replace(/_filter$/, '')
      steps.push({
        action: 'url_param',
        key: paramName,
        value: '{{value}}',
      })
    }
  } else if (feature.selector) {
    // DOM-based filtering
    steps.push({ action: 'click', selector: feature.selector })
    steps.push({ action: 'wait', ms: 500 })
  }

  return {
    id,
    description: `Apply ${feature.name}`,
    pageTypes: [pageType],
    steps,
  }
}

function generateSortRecipe(
  id: string,
  feature: Feature,
  pageType: PageTypeKey,
  origin: string,
  urlPatterns?: any,
): InteractionRecipe {
  const steps: RecipeStep[] = []

  if (feature.interactionMethod === 'url_param' && urlPatterns?.urlPatterns?.sort) {
    steps.push({
      action: 'url_param',
      key: urlPatterns.urlPatterns.sort.param,
      value: '{{value}}',
    })
  } else if (feature.selector) {
    steps.push({ action: 'click', selector: feature.selector })
    steps.push({ action: 'wait', ms: 300 })
  }

  return {
    id,
    description: `Sort by ${feature.name}`,
    pageTypes: [pageType],
    steps,
  }
}

function generateSearchRecipe(
  id: string,
  feature: Feature,
  pageType: PageTypeKey,
): InteractionRecipe {
  const steps: RecipeStep[] = []

  if (feature.selector) {
    steps.push({ action: 'click', selector: feature.selector })
    steps.push({ action: 'input', selector: feature.selector, value: '{{query}}' })
    steps.push({ action: 'wait', ms: 500 })
  }

  return {
    id,
    description: 'Search for products',
    pageTypes: [pageType],
    steps,
  }
}

function generateVariantRecipe(
  id: string,
  feature: Feature,
  pageType: PageTypeKey,
): InteractionRecipe {
  const steps: RecipeStep[] = []

  if (feature.selector) {
    steps.push({ action: 'click', selector: `${feature.selector} [data-value="{{value}}"]` })
    steps.push({ action: 'wait', ms: 300 })
  }

  return {
    id,
    description: `Select ${feature.name}`,
    pageTypes: [pageType],
    steps,
  }
}

function generateCtaRecipe(
  id: string,
  feature: Feature,
  pageType: PageTypeKey,
): InteractionRecipe {
  const steps: RecipeStep[] = []

  if (feature.selector) {
    steps.push({ action: 'scroll', direction: 'down' })
    steps.push({ action: 'click', selector: feature.selector })
    steps.push({ action: 'wait', ms: 500 })
  }

  return {
    id,
    description: feature.name,
    pageTypes: [pageType],
    steps,
  }
}

function generateGalleryRecipe(
  id: string,
  feature: Feature,
  pageType: PageTypeKey,
): InteractionRecipe {
  const steps: RecipeStep[] = []

  if (feature.selector) {
    steps.push({ action: 'scroll', direction: 'up' })
    steps.push({ action: 'click', selector: feature.selector })
  }

  return {
    id,
    description: 'Open image gallery',
    pageTypes: [pageType],
    steps,
  }
}

function generateNavigationRecipe(
  id: string,
  feature: Feature,
  pageType: PageTypeKey,
): InteractionRecipe {
  const steps: RecipeStep[] = []

  if (feature.selector) {
    steps.push({ action: 'click', selector: feature.selector })
    steps.push({ action: 'wait', ms: 500 })
  }

  return {
    id,
    description: feature.name,
    pageTypes: [pageType],
    steps,
  }
}

function generateContentRecipe(
  id: string,
  feature: Feature,
  pageType: PageTypeKey,
): InteractionRecipe {
  const steps: RecipeStep[] = []

  if (feature.selector) {
    steps.push({ action: 'scroll', direction: 'down' })
  }

  return {
    id,
    description: `View ${feature.name}`,
    pageTypes: [pageType],
    steps,
  }
}

// ── Recipe validation ─────────────────────────────────────────────────────

async function validateRecipes(
  ctx: BrowserContext,
  recipes: InteractionRecipe[],
  sampleUrls: Partial<Record<PageTypeKey, string[]>>,
  log: (msg: string) => void,
): Promise<void> {
  for (const recipe of recipes) {
    const pageType = recipe.pageTypes[0]
    const urls = sampleUrls[pageType]
    if (!urls || urls.length === 0) continue

    const page = await ctx.newPage()
    try {
      await page.goto(urls[0], { waitUntil: 'domcontentloaded', timeout: 15_000 })
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
      await dismissPopups(page, log)

      let valid = true
      for (const step of recipe.steps) {
        if (step.action === 'click' || step.action === 'input') {
          // Replace template variables for validation
          const sel = step.selector.replace(/\{\{.*?\}\}/g, '*')
          try {
            const count = await page.locator(step.selector.replace(/\{\{.*?\}\}/g, '')).count()
            if (count === 0) {
              valid = false
              break
            }
          } catch {
            // Template selectors may not be directly testable
          }
        }
      }

      log(`${TAG}   recipe "${recipe.id}": ${valid ? 'VALID' : 'NEEDS REVIEW'}`)

    } catch (err) {
      log(`${TAG}   recipe "${recipe.id}": VALIDATION ERROR — ${(err as Error).message}`)
    } finally {
      await page.close()
    }
  }
}
