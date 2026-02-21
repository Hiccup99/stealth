import { useEffect, useRef } from "preact/hooks";
import { associateStore } from "@/store/associateStore";

export function GhostCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const isActive = associateStore.getState().isActive;

  useEffect(() => {
    if (!isActive || !cursorRef.current) return;
    // Ghost cursor animation logic will be wired here (GSAP / Web Animations API)
  }, [isActive]);

  if (!isActive) return null;

  return (
    <div
      ref={cursorRef}
      class="pointer-events-none fixed z-[999999] h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-wakefit-primary bg-wakefit-primary/20 shadow-lg transition-transform"
      style={{ top: 0, left: 0 }}
      aria-hidden="true"
    />
  );
}
