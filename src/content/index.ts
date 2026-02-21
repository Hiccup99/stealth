import { mountAssociate } from "./mount";

let mounted = false;

function init() {
  if (mounted) return;
  mounted = true;
  mountAssociate();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "PAGE_READY") {
    mounted = false;
    init();
  }
});
