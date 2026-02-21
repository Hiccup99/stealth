/**
 * popup-handler.ts
 *
 * Detects and dismisses common overlays that block page content:
 *  - Cookie consent banners (OneTrust, Cookiebot, GDPR popups)
 *  - Newsletter subscription modals
 *  - Promotional / discount offer overlays
 *  - Age verification gates
 *  - App download prompts
 *  - Location / language selection modals
 *
 * Called before any element extraction on every page.
 */

import type { Page } from 'playwright'

const TAG = '[popup-handler]'

// ── Selector catalog ──────────────────────────────────────────────────────────

/** Buttons that accept/close overlays — tried in order */
const ACCEPT_SELECTORS = [
  // OneTrust
  '#onetrust-accept-btn-handler',
  '.onetrust-accept-btn-handler',
  '#accept-recommended-btn-handler',

  // Cookiebot
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#CybotCookiebotDialogBodyButtonAccept',

  // Generic cookie banners
  'button[class*="cookie"][class*="accept" i]',
  'button[class*="cookie"][class*="allow" i]',
  'button[class*="cookie"][class*="agree" i]',
  'button[class*="consent"][class*="accept" i]',
  'button[id*="accept-cookie" i]',
  'button[id*="cookie-accept" i]',
  'a[class*="cookie-accept" i]',

  // Generic close buttons for modals
  'button[aria-label="Close"]',
  'button[aria-label="close"]',
  'button[aria-label="Dismiss"]',
  '[class*="modal"] button[class*="close"]',
  '[class*="modal"] [class*="close-btn"]',
  '[class*="popup"] button[class*="close"]',
  '[class*="overlay"] button[class*="close"]',
  '[class*="dialog"] button[class*="close"]',

  // Newsletter modals
  'button[class*="no-thanks" i]',
  'button[class*="nothanks" i]',
  'button[class*="no_thanks" i]',
  'a[class*="no-thanks" i]',
  '[class*="newsletter"] button[class*="close"]',

  // Promotional overlays
  '[class*="promo"] button[class*="close"]',
  '[class*="offer"] button[class*="close"]',

  // App install banners
  '[class*="app-banner"] button[class*="close"]',
  '[class*="smart-banner"] button[class*="close"]',
  '#smartbanner .sb-close',

  // Location / store selector skip
  'button[class*="skip"][class*="location" i]',
  'button[class*="continue" i][class*="without" i]',

  // × symbol buttons near top of page
  '[class*="modal-close"]',
  '[class*="modal__close"]',
  '[data-dismiss="modal"]',
  '[data-testid*="close"]',
  '[data-testid*="modal-close"]',
]

/** Overlay wrapper selectors — if visible, we know there's a blocking overlay */
const OVERLAY_SELECTORS = [
  '#onetrust-banner-sdk',
  '.onetrust-banner-sdk',
  '[id*="cookie-banner"]',
  '[class*="cookie-banner"]',
  '[class*="gdpr-banner"]',
  '[class*="consent-banner"]',
  '[class*="cookie-consent"]',
  '#CookieBanner',
  '#CybotCookiebotDialog',
  '[class*="newsletter-popup"]',
  '[class*="email-popup"]',
  '[class*="promo-popup"]',
  '[class*="discount-popup"]',
  '[class*="offer-popup"]',
  '[class*="age-gate"]',
  '[class*="age-verification"]',
  '[class*="location-modal"]',
  '[class*="country-selector"]',
  '[id*="country-modal"]',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

async function clickIfVisible(page: Page, selector: string): Promise<boolean> {
  try {
    const el = page.locator(selector).first()
    const isVisible = await el.isVisible({ timeout: 1_500 })
    if (isVisible) {
      await el.click({ timeout: 2_000, force: true })
      return true
    }
  } catch {
    // not present or not clickable — skip
  }
  return false
}

async function pressEscapeOnOverlay(page: Page): Promise<boolean> {
  try {
    // Check if any overlay is visible
    for (const sel of OVERLAY_SELECTORS) {
      const visible = await page.locator(sel).first().isVisible({ timeout: 500 }).catch(() => false)
      if (visible) {
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)
        return true
      }
    }
  } catch {
    // ignore
  }
  return false
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Attempt to dismiss all blocking overlays on the current page.
 * Safe to call multiple times; ignores errors if nothing matches.
 *
 * @returns number of overlays dismissed
 */
export async function dismissPopups(page: Page, log: (msg: string) => void): Promise<number> {
  let dismissed = 0

  // Wait a short moment for dynamically injected banners
  await page.waitForTimeout(800)

  // Round 1: try each known accept/close button
  for (const sel of ACCEPT_SELECTORS) {
    const clicked = await clickIfVisible(page, sel)
    if (clicked) {
      dismissed++
      log(`${TAG} dismissed overlay via: ${sel}`)
      await page.waitForTimeout(300)
    }
  }

  // Round 2: try Escape key if overlays still visible
  const escaped = await pressEscapeOnOverlay(page)
  if (escaped) {
    dismissed++
    log(`${TAG} dismissed overlay via Escape key`)
  }

  // Round 3: try any visible × / close text buttons not matched above
  if (dismissed === 0) {
    const closed = await tryCloseByText(page)
    if (closed) {
      dismissed++
      log(`${TAG} dismissed overlay via text-content close button`)
    }
  }

  if (dismissed > 0) {
    await page.waitForTimeout(500)
    log(`${TAG} total overlays dismissed: ${dismissed}`)
  } else {
    log(`${TAG} no overlays detected`)
  }

  return dismissed
}

/** Last resort: click any visible button whose text is a common dismiss phrase */
async function tryCloseByText(page: Page): Promise<boolean> {
  const CLOSE_PHRASES = ['accept', 'accept all', 'allow all', 'agree', 'ok', 'got it', 'continue', 'no thanks', 'close', '×', '✕']

  for (const phrase of CLOSE_PHRASES) {
    try {
      const buttons = await page.getByRole('button', { name: new RegExp(`^${phrase}$`, 'i') }).all()
      for (const btn of buttons) {
        const visible = await btn.isVisible({ timeout: 500 }).catch(() => false)
        if (visible) {
          await btn.click({ timeout: 2_000, force: true })
          return true
        }
      }
    } catch {
      // skip
    }
  }
  return false
}
