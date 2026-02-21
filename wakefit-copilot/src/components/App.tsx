import { useEffect } from 'preact/hooks'
import { GhostCursor } from './GhostCursor'
import { CopilotPanel } from '@/content/components/CopilotPanel'
import { HighlightOverlay } from '@/content/components/HighlightOverlay'
import { destroy as destroyCursor } from '@/content/modules/ghost-cursor'

export function App() {
  // ghost-cursor.ts lazily creates its DOM elements on first use (ensureCursor()).
  // We only need to clean them up on unmount (SPA navigations create a fresh App).
  useEffect(() => {
    return destroyCursor
  }, [])

  return (
    <>
      <GhostCursor />
      <HighlightOverlay />
      <CopilotPanel />
    </>
  )
}
