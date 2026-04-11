// ============================================================
// 强制复制 - Service Worker
// 职责：管理启用站点列表、响应消息、更新 badge
// ============================================================

const STORAGE_KEY = 'enabledSites';

// 安装时初始化默认值
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    if (result[STORAGE_KEY] === undefined) {
      chrome.storage.local.set({ [STORAGE_KEY]: [] });
    }
  });
});

// 监听来自 content script 和 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_STATUS':
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        const sites = result[STORAGE_KEY] || [];
        const enabled = sites.includes(message.hostname);
        sendResponse({ enabled });
      });
      return true; // 异步 sendResponse

    case 'TOGGLE_SITE':
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        let sites = result[STORAGE_KEY] || [];
        const hostname = message.hostname;

        if (sites.includes(hostname)) {
          sites = sites.filter((s) => s !== hostname);
        } else {
          sites.push(hostname);
        }

        chrome.storage.local.set({ [STORAGE_KEY]: sites }, () => {
          // 更新 badge：优先使用 popup 传来的 tabId，否则用 sender.tab
          const tabId = message.tabId || (sender.tab && sender.tab.id);
          if (tabId) {
            updateBadge(tabId, hostname, sites);
          }
          sendResponse({ enabled: sites.includes(hostname), sites });
        });
      });
      return true; // 异步 sendResponse

    default:
      return false;
  }
});

// 标签页更新时刷新 badge
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    try {
      const hostname = new URL(tab.url).hostname;
      updateBadgeForTab(tabId, hostname);
    } catch (e) {
      // 无效 URL，忽略
    }
  }
});

// 标签页切换时刷新 badge
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab.url) {
      try {
        const hostname = new URL(tab.url).hostname;
        updateBadgeForTab(activeInfo.tabId, hostname);
      } catch (e) {
        // 忽略
      }
    }
  });
});

function updateBadgeForTab(tabId, hostname) {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    const sites = result[STORAGE_KEY] || [];
    updateBadge(tabId, hostname, sites);
  });
}

function updateBadge(tabId, hostname, enabledSites) {
  const enabled = enabledSites.includes(hostname);

  chrome.action.setBadgeText({
    text: enabled ? 'ON' : '',
    tabId: tabId
  });

  chrome.action.setBadgeBackgroundColor({
    color: '#4CAF50',
    tabId: tabId
  });
}
