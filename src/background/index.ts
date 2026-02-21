chrome.runtime.onInstalled.addListener(() => {
  console.log("[Wakefit Associate] Extension installed");
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url?.match(/https?:\/\/(www\.)?wakefit\.co/)
  ) {
    chrome.tabs.sendMessage(tabId, { type: "PAGE_READY", url: tab.url });
  }
});
