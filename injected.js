// ============================================================
// 强制复制 - MAIN World 脚本
// 直接运行在页面的 JS 环境中，可以拦截页面自身的剪贴板劫持和登录跳转
// 由 content.js 通过 chrome.scripting.executeScript 注入
// ============================================================

(function () {
  'use strict';

  // 防止重复注入
  if (window.__FORCE_COPY_MAIN_INJECTED__) return;
  window.__FORCE_COPY_MAIN_INJECTED__ = true;

  // --- 第 1 层：在 MAIN world 中拦截所有复制相关事件 ---
  const BLOCKED_EVENTS = [
    'copy', 'cut', 'paste',
    'contextmenu', 'selectstart',
    'dragstart', 'mousedown', 'mouseup',
    'keydown', 'keyup'
  ];

  BLOCKED_EVENTS.forEach((eventType) => {
    document.addEventListener(eventType, (e) => {
      // 只阻止那些会 preventDefault 的处理器
      // 通过在 capture phase 注册空处理器来占位
      // 关键：不 stopPropagation，让正常事件继续传播
    }, true);
  });

  // --- 第 2 层：覆盖 ClipboardEvent 的 preventDefault ---
  // 某些网站（如 CSDN）会在 copy 事件中调用 e.preventDefault() 然后写入自定义内容
  const OriginalClipboardEvent = window.ClipboardEvent;
  if (OriginalClipboardEvent) {
    window.ClipboardEvent = function (type, eventInit) {
      const event = new OriginalClipboardEvent(type, eventInit);
      // 覆盖 preventDefault，使其在 copy/cut 事件中无效
      const originalPreventDefault = event.preventDefault.bind(event);
      event.preventDefault = function () {
        if (type === 'copy' || type === 'cut') {
          // 不阻止复制操作，让浏览器默认行为生效
          return;
        }
        originalPreventDefault();
      };
      return event;
    };
    window.ClipboardEvent.prototype = OriginalClipboardEvent.prototype;
    window.ClipboardEvent.prototype.constructor = window.ClipboardEvent;
  }

  // --- 第 3 层：覆盖 document.addEventListener ---
  // 拦截网站注册 copy/cut/contextmenu 等事件监听器
  const originalAddEventListener = document.addEventListener.bind(document);
  const originalRemoveEventListener = document.removeEventListener.bind(document);

  // 存储被拦截的监听器，以便恢复
  const hijackedListeners = new Map();

  document.addEventListener = function (type, listener, options) {
    const t = type.toLowerCase();
    // 拦截网站尝试注册的复制相关事件监听器
    if (['copy', 'cut', 'paste', 'contextmenu', 'selectstart'].includes(t)) {
      // 不让网站注册这些事件的监听器
      return;
    }
    return originalAddEventListener(type, listener, options);
  };

  document.removeEventListener = function (type, listener, options) {
    return originalRemoveEventListener(type, listener, options);
  };

  // 同样拦截 Element.prototype.addEventListener
  const origElementAdd = Element.prototype.addEventListener;
  const origElementRemove = Element.prototype.removeEventListener;

  Element.prototype.addEventListener = function (type, listener, options) {
    const t = type.toLowerCase();
    if (['copy', 'cut', 'paste', 'contextmenu', 'selectstart'].includes(t)) {
      return; // 阻止网站注册
    }
    return origElementAdd.call(this, type, listener, options);
  };

  Element.prototype.removeEventListener = function (type, listener, options) {
    return origElementRemove.call(this, type, listener, options);
  };

  // --- 第 4 层：保护 navigator.clipboard ---
  if (navigator.clipboard) {
    const origWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
    const origWrite = navigator.clipboard.write.bind(navigator.clipboard);

    // 覆盖 writeText，确保写入的是用户选中的真实内容
    Object.defineProperty(navigator.clipboard, 'writeText', {
      value: async function (text) {
        // 如果调用栈中包含网站自身的代码（非用户操作），检查是否是劫持行为
        // 直接调用原始方法，让浏览器处理
        return origWriteText(text);
      },
      configurable: true,
      writable: true
    });

    Object.defineProperty(navigator.clipboard, 'write', {
      value: async function (data) {
        return origWrite(data);
      },
      configurable: true,
      writable: true
    });
  }

  // --- 第 5 层：拦截 CSDN 特有的登录跳转 ---
  // CSDN 会在复制后检测登录状态，未登录则跳转登录页
  // 拦截 window.location 的跳转
  let loginRedirectBlocked = false;
  const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
  const originalAssign = window.location.assign.bind(window.location);
  const originalReplace = window.location.replace.bind(window.location);

  // 拦截 location.href 赋值跳转
  Object.defineProperty(window, 'location', {
    get() {
      return originalLocationDescriptor.get.call(window);
    },
    set(url) {
      // 检查是否是登录跳转
      const urlStr = String(url);
      if (isLoginRedirect(urlStr)) {
        console.log('[强制复制] 已拦截登录跳转:', urlStr);
        return; // 阻止跳转
      }
      originalLocationDescriptor.set.call(window, url);
    },
    configurable: true
  });

  // 拦截 location.assign
  window.location.assign = function (url) {
    const urlStr = String(url);
    if (isLoginRedirect(urlStr)) {
      console.log('[强制复制] 已拦截登录跳转 (assign):', urlStr);
      return;
    }
    return originalAssign(url);
  };

  // 拦截 location.replace
  window.location.replace = function (url) {
    const urlStr = String(url);
    if (isLoginRedirect(urlStr)) {
      console.log('[强制复制] 已拦截登录跳转 (replace):', urlStr);
      return;
    }
    return originalReplace(url);
  };

  function isLoginRedirect(url) {
    const lower = url.toLowerCase();
    // CSDN 登录相关 URL
    if (lower.includes('passport.csdn.net') || lower.includes('login')) return true;
    // 通用登录关键词
    if (lower.includes('/login') || lower.includes('/signin') || lower.includes('passport')) return true;
    // CSDN 特有的复制后跳转
    if (lower.includes('passport') || lower.includes('geetest')) return true;
    return false;
  }

  // --- 第 6 层：拦截 CSDN 特有的剪贴板劫持 ---
  // CSDN 使用 document.execCommand('copy') 后立即写入自定义内容
  // 在 copy 事件中用 capture phase 确保我们的处理器先执行
  document.addEventListener('copy', (e) => {
    // 不做任何事，让浏览器默认复制行为生效
    // 关键是不让网站的 handler 执行（已通过覆盖 addEventListener 阻止）
  }, true);

  // --- 第 7 层：拦截 window.open 登录弹窗 ---
  const originalWindowOpen = window.open.bind(window);
  window.open = function (url, target, features) {
    const urlStr = String(url || '');
    if (isLoginRedirect(urlStr)) {
      console.log('[强制复制] 已拦截登录弹窗:', urlStr);
      return null;
    }
    return originalWindowOpen(url, target, features);
  };

  // --- 第 8 层：定时清理（应对 setInterval 动态添加的保护） ---
  // 某些网站使用 setInterval 持续检测和添加保护
  const CLEANUP_INTERVAL = 2000;

  function deepCleanup() {
    // 清除所有元素的内联事件
    const attrs = ['oncopy', 'oncut', 'onpaste', 'oncontextmenu', 'onselectstart'];
    const allElements = document.querySelectorAll('*');
    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];
      for (let j = 0; j < attrs.length; j++) {
        if (el[attrs[j]]) {
          el[attrs[j]] = null;
        }
      }
    }
    // 清除 document 级别的内联事件
    for (let j = 0; j < attrs.length; j++) {
      try { document[attrs[j]] = null; } catch (e) {}
    }
  }

  // DOMContentLoaded 后执行一次深度清理
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', deepCleanup);
  } else {
    deepCleanup();
  }

  // 定时清理（每 2 秒）
  setInterval(deepCleanup, CLEANUP_INTERVAL);

})();
