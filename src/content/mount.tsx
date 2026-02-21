import { render } from "preact";
import { GhostCursor } from "@/components/GhostCursor";
import tailwindStyles from "./styles.css?inline";

export function mountAssociate() {
  const host = document.createElement("div");
  host.id = "wakefit-associate-root";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const styleEl = document.createElement("style");
  styleEl.textContent = tailwindStyles;
  shadow.appendChild(styleEl);

  const container = document.createElement("div");
  shadow.appendChild(container);

  render(<GhostCursor />, container);
}
