/**
 * performance-monitor.ts
 *
 * Tracks performance budgets and logs warnings when exceeded.
 * Exposed via window.__wakefitCopilot.performance for debugging.
 */

export interface PerformanceMetrics {
  scriptInjection: number
  shadowMount: number
  pageScan: number
  llmNano: number[]
  llmCloud: number[]
  memoryMB: number
  bundleSizeKB: number
}

const metrics: PerformanceMetrics = {
  scriptInjection: 0,
  shadowMount: 0,
  pageScan: 0,
  llmNano: [],
  llmCloud: [],
  memoryMB: 0,
  bundleSizeKB: 0,
}

const BUDGETS = {
  scriptInjection: 50,
  shadowMount: 100,
  pageScan: 200,
  llmNano: 2000,
  llmCloud: 4000,
  memoryMB: 30,
  bundleSizeKB: 150,
} as const

export function recordScriptInjection(ms: number): void {
  metrics.scriptInjection = ms
  if (ms > BUDGETS.scriptInjection) {
    console.warn(`[Performance] Script injection exceeded budget: ${ms.toFixed(1)}ms > ${BUDGETS.scriptInjection}ms`)
  }
}

export function recordShadowMount(ms: number): void {
  metrics.shadowMount = ms
  if (ms > BUDGETS.shadowMount) {
    console.warn(`[Performance] Shadow mount exceeded budget: ${ms.toFixed(1)}ms > ${BUDGETS.shadowMount}ms`)
  }
}

export function recordPageScan(ms: number): void {
  metrics.pageScan = ms
  if (ms > BUDGETS.pageScan) {
    console.warn(`[Performance] Page scan exceeded budget: ${ms.toFixed(1)}ms > ${BUDGETS.pageScan}ms`)
  }
}

export function recordLLMResponse(mode: 'nano' | 'cloud', ms: number): void {
  if (mode === 'nano') {
    metrics.llmNano.push(ms)
    if (ms > BUDGETS.llmNano) {
      console.warn(`[Performance] LLM Nano response exceeded budget: ${ms.toFixed(1)}ms > ${BUDGETS.llmNano}ms`)
    }
  } else {
    metrics.llmCloud.push(ms)
    if (ms > BUDGETS.llmCloud) {
      console.warn(`[Performance] LLM Cloud response exceeded budget: ${ms.toFixed(1)}ms > ${BUDGETS.llmCloud}ms`)
    }
  }
}

export function updateMemory(): void {
  if ('memory' in performance) {
    const mem = (performance as any).memory.usedJSHeapSize / 1024 / 1024
    metrics.memoryMB = mem
    if (mem > BUDGETS.memoryMB) {
      console.warn(`[Performance] Memory exceeded budget: ${mem.toFixed(1)}MB > ${BUDGETS.memoryMB}MB`)
    }
  }
}

export function getMetrics(): PerformanceMetrics {
  updateMemory()
  return { ...metrics }
}

export function getSummary(): string {
  updateMemory()
  const nanoAvg = metrics.llmNano.length
    ? (metrics.llmNano.reduce((a, b) => a + b, 0) / metrics.llmNano.length).toFixed(0)
    : 'N/A'
  const cloudAvg = metrics.llmCloud.length
    ? (metrics.llmCloud.reduce((a, b) => a + b, 0) / metrics.llmCloud.length).toFixed(0)
    : 'N/A'

  return `
Performance Metrics:
  Script injection: ${metrics.scriptInjection.toFixed(1)}ms (budget: ${BUDGETS.scriptInjection}ms)
  Shadow mount:     ${metrics.shadowMount.toFixed(1)}ms (budget: ${BUDGETS.shadowMount}ms)
  Page scan:        ${metrics.pageScan.toFixed(1)}ms (budget: ${BUDGETS.pageScan}ms)
  LLM Nano avg:     ${nanoAvg}ms (budget: ${BUDGETS.llmNano}ms)
  LLM Cloud avg:    ${cloudAvg}ms (budget: ${BUDGETS.llmCloud}ms)
  Memory:           ${metrics.memoryMB.toFixed(1)}MB (budget: ${BUDGETS.memoryMB}MB)
  Bundle size:      ${metrics.bundleSizeKB.toFixed(1)}KB gzipped (budget: ${BUDGETS.bundleSizeKB}KB)
`.trim()
}

// Expose to window for debugging
if (typeof window !== 'undefined') {
  (window as any).__wakefitCopilot = (window as any).__wakefitCopilot || {}
  ;(window as any).__wakefitCopilot.performance = {
    getMetrics,
    getSummary,
    recordScriptInjection,
    recordShadowMount,
    recordPageScan,
    recordLLMResponse,
    updateMemory,
  }
}
