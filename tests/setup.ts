// Global test setup
// Mock Chrome extension APIs
const chromeMock = {
  runtime: {
    onInstalled: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    sendMessage: () => Promise.resolve(),
  },
  tabs: {
    query: () => Promise.resolve([{ id: 1, url: "https://www.wakefit.co/" }]),
    sendMessage: () => Promise.resolve({ answer: "mock answer" }),
    onUpdated: { addListener: () => {} },
  },
  storage: {
    sync: {
      get: () => Promise.resolve({}),
      set: () => Promise.resolve(),
    },
  },
  action: {
    onClicked: { addListener: () => {} },
  },
  sidePanel: {
    open: () => Promise.resolve(),
  },
};

(globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;
