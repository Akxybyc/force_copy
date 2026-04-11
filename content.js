// ============================================================
// 强制复制 - Content Script
// 注入时机: document_start (在页面脚本之前执行)
// 分层防御: 站点开关 → 事件拦截 → 内联事件清除 → Clipboard API 保护 → MutationObserver → MAIN world 注入
// ============================================================

(function () {
  'use strict';

  // 排除特殊协议页面
  const protocol = location.protocol;
  if (
    protocol === 'chrome:' ||
    protocol === 'chrome-extension:' ||
    protocol === 'about:' ||
    protocol === 'edge:' ||
    protocol === 'devtools:'
  ) {
    return;
  }

  const STORAGE_KEY = 'enabledSites';

  let isEnabled = false;
  let cleanupFns = []; // 存储所有清理函数，便于禁用时恢复
  let observer = null;

  // 需要拦截的事件类型
  const BLOCKED_EVENTS = [
    'copy', 'cut', 'paste',           // 剪贴板事件
    'contextmenu',                     // 右键菜单
    'selectstart',                     // 选择开始
    'dragstart',                       // 拖拽开始
    'mousedown',                       // 鼠标按下（部分网站通过此阻止选择）
  ];

  // 需要清除的内联事件属性
  const INLINE_EVENT_ATTRS = [
    'oncopy', 'oncut', 'onpaste',
    'oncontextmenu', 'onselectstart',
    'ondragstart', 'onmousedown', 'onmouseup'
  ];

  // --- 第 0 层：检查本站点是否启用了强制复制 ---
  // 直接从 storage 读取，不依赖 background（避免 Service Worker 未启动的问题）

  function checkAndEnable() {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) return;
      const sites = result[STORAGE_KEY] || [];
      if (sites.includes(location.hostname)) {
        enableForceCopy();
      }
    });
  }

  // 立即检查一次
  checkAndEnable();

  // 监听 storage 变化，实时响应开关切换
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE_KEY]) {
      const sites = changes[STORAGE_KEY].newValue || [];
      const wasEnabled = isEnabled;
      const nowEnabled = sites.includes(location.hostname);

      if (nowEnabled && !wasEnabled) {
        enableForceCopy();
      } else if (!nowEnabled && wasEnabled) {
        disableForceCopy();
      }
    }
  });

  // --- 启用/禁用控制 ---

  function enableForceCopy() {
    if (isEnabled) return;
    isEnabled = true;

    // 第 1 层：Capture Phase 事件拦截
    enableEventInterception();

    // 第 2 层：清除已有的内联事件处理器
    clearInlineHandlers();

    // 第 3 层：保护 Clipboard API
    protectClipboardAPI();

    // 第 4 层：启动 MutationObserver 监控动态内容
    startMutationObserver();

    // 第 5 层：注入 MAIN world 脚本（拦截页面自身的 JS 行为）
    injectMainWorldScript();

    // 如果 DOM 已部分加载，对现有元素做一次清理
    if (document.body) {
      clearInlineHandlers();
    } else {
      document.addEventListener('DOMContentLoaded', clearInlineHandlers);
    }
  }

  function disableForceCopy() {
    if (!isEnabled) return;
    isEnabled = false;

    cleanupFns.forEach((fn) => {
      try { fn(); } catch (e) { /* 忽略清理错误 */ }
    });
    cleanupFns = [];
    observer = null;
  }

  // --- 第 1 层：Capture Phase 事件拦截 ---

  function enableEventInterception() {
    BLOCKED_EVENTS.forEach((eventType) => {
      const handler = (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
      };
      document.addEventListener(eventType, handler, true);
      cleanupFns.push(() => {
        document.removeEventListener(eventType, handler, true);
      });
    });
  }

  // --- 第 2 层：内联事件处理器清除 ---

  function clearInlineHandlers() {
    INLINE_EVENT_ATTRS.forEach((attr) => {
      try { document[attr] = null; } catch (e) { /* 忽略 */ }
    });

    if (!document.body) return;
    const allElements = document.querySelectorAll('*');
    allElements.forEach((el) => {
      INLINE_EVENT_ATTRS.forEach((attr) => {
        if (el[attr]) {
          el[attr] = null;
        }
      });
    });
  }

  // --- 第 3 层：Clipboard API 保护 ---

  function protectClipboardAPI() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
      try {
        Object.defineProperty(navigator.clipboard, 'writeText', {
          value: originalWriteText,
          configurable: true,
          writable: true
        });
      } catch (e) { /* 属性被冻结，忽略 */ }
    }

    if (navigator.clipboard && navigator.clipboard.readText) {
      const originalReadText = navigator.clipboard.readText.bind(navigator.clipboard);
      try {
        Object.defineProperty(navigator.clipboard, 'readText', {
          value: originalReadText,
          configurable: true,
          writable: true
        });
      } catch (e) { /* 忽略 */ }
    }

    if (document.execCommand) {
      const originalExecCommand = document.execCommand.bind(document);
      try {
        Object.defineProperty(document, 'execCommand', {
          value: originalExecCommand,
          configurable: true,
          writable: true
        });
      } catch (e) { /* 忽略 */ }
    }
  }

  // --- 第 4 层：MutationObserver 持续监控 ---

  let debounceTimer = null;

  function startMutationObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      let needsCleanup = false;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            needsCleanup = true;
            break;
          }
        }
        if (needsCleanup) break;

        if (mutation.type === 'attributes' && mutation.attributeName) {
          const attr = mutation.attributeName.toLowerCase();
          if (attr.startsWith('on') || attr === 'style' || attr === 'draggable') {
            needsCleanup = true;
          }
        }
        if (needsCleanup) break;
      }

      if (needsCleanup) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          clearInlineHandlers();
          debounceTimer = null;
        }, 100);
      }
    });

    const target = document.documentElement || document;
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'oncopy', 'oncut', 'onpaste',
        'oncontextmenu', 'onselectstart',
        'ondragstart', 'onmousedown',
        'onmouseup', 'style', 'draggable'
      ]
    });

    cleanupFns.push(() => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    });
  }

  // --- 第 5 层：注入 MAIN world 脚本 ---
  // 在页面的 JS 环境中运行，可以拦截页面自身的剪贴板劫持和登录跳转

  function injectMainWorldScript() {
    // 读取 injected.js 的内容并注入到 MAIN world
    const scriptUrl = chrome.runtime.getURL('injected.js');
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.onload = function () {
      script.remove(); // 加载后移除 script 标签
    };
    // 尽早注入到 head 或 body
    (document.head || document.documentElement).appendChild(script);
  }

})();
