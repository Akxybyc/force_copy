// ============================================================
// 强制复制 - Popup 逻辑
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  const hostnameEl = document.getElementById('hostname');
  const statusText = document.getElementById('statusText');
  const toggleSwitch = document.getElementById('toggleSwitch');
  const enabledCountEl = document.getElementById('enabledCount');
  const tipEl = document.getElementById('tip');

  // 获取当前标签页信息
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url) {
    hostnameEl.textContent = '无法识别当前页面';
    toggleSwitch.disabled = true;
    return;
  }

  // 排除特殊页面
  const url = new URL(tab.url);
  if (
    url.protocol === 'chrome:' ||
    url.protocol === 'chrome-extension:' ||
    url.protocol === 'about:' ||
    url.protocol === 'edge:' ||
    url.protocol === 'devtools:'
  ) {
    hostnameEl.textContent = url.protocol + '//';
    toggleSwitch.disabled = true;
    statusText.textContent = '此页面不支持';
    return;
  }

  const hostname = url.hostname;
  hostnameEl.textContent = hostname;

  // 读取当前状态
  chrome.storage.local.get(['enabledSites'], ({ enabledSites = [] }) => {
    const isEnabled = enabledSites.includes(hostname);
    toggleSwitch.checked = isEnabled;
    updateStatusUI(isEnabled);
    enabledCountEl.textContent = `已为 ${enabledSites.length} 个站点启用`;

    // 切换开关
    toggleSwitch.addEventListener('change', () => {
      // 显示提示
      tipEl.style.display = 'block';

      // 先更新 UI，让用户看到状态变化
      const newEnabled = toggleSwitch.checked;
      updateStatusUI(newEnabled);

      // 直接操作 storage（popup 关闭前一定能完成）
      let updatedSites;
      if (newEnabled) {
        updatedSites = enabledSites.includes(hostname) ? enabledSites : [...enabledSites, hostname];
      } else {
        updatedSites = enabledSites.filter((s) => s !== hostname);
      }

      chrome.storage.local.set({ enabledSites: updatedSites }, () => {
        enabledCountEl.textContent = `已为 ${updatedSites.length} 个站点启用`;

        // 立即刷新页面（不延迟），popup 会被浏览器自动关闭
        chrome.tabs.reload(tab.id);
      });
    });
  });

  function updateStatusUI(isEnabled) {
    if (isEnabled) {
      statusText.textContent = '已启用 — 页面即将刷新...';
      statusText.classList.add('active');
    } else {
      statusText.textContent = '已关闭 — 页面即将刷新...';
      statusText.classList.remove('active');
    }
  }
});
