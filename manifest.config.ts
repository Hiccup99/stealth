import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Wakefit Showroom Associate",
  version: "0.1.0",
  description:
    "An AI-powered ghost cursor showroom associate for wakefit.co that guides you through product discovery.",
  permissions: ["storage", "activeTab", "scripting", "sidePanel"],
  host_permissions: ["https://www.wakefit.co/*", "https://wakefit.co/*"],
  action: {
    default_title: "Wakefit Showroom Associate",
    default_popup: "src/popup/index.html",
    default_icon: {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  icons: {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module"
  },
  content_scripts: [
    {
      matches: ["https://www.wakefit.co/*", "https://wakefit.co/*"],
      js: ["src/content/index.ts"],
      run_at: "document_idle"
    }
  ],
  side_panel: {
    default_path: "src/sidepanel/index.html"
  },
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'self'"
  },
  web_accessible_resources: [
    {
      resources: ["src/content/styles.css"],
      matches: ["https://www.wakefit.co/*", "https://wakefit.co/*"]
    }
  ]
});
