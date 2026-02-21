import { useEffect, useRef } from 'preact/hooks'
import { associateStore } from '@/store/associateStore'

export function GhostCursor() {
  const cursorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return associateStore.subscribe((state) => {
      const el = cursorRef.current
      if (!el) return
      el.style.transform = `translate(${state.cursorPosition.x}px, ${state.cursorPosition.y}px)`
    })
  }, [])

  const isActive = associateStore.getState().isActive
  if (!isActive) return null

  return (
    <div
      ref={cursorRef}
      class="pointer-events-none fixed left-0 top-0 z-[999999] h-6 w-6 rounded-full border-2 border-wakefit-primary bg-wakefit-primary/20 shadow-lg will-change-transform"
      aria-hidden="true"
    />
  )
}
