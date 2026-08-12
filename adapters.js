(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PromptSafeguardAdapters = api;
})(globalThis, function () {
  "use strict";

  const GENERIC_SELECTORS = [
    "textarea",
    "[role='textbox']",
    "[contenteditable='true'][role='textbox']",
    "[contenteditable='true'][data-lexical-editor='true']",
    "[contenteditable='true'].ProseMirror",
    "[contenteditable='true']"
  ];

  const adapters = [
    {
      id: "chatgpt",
      label: "ChatGPT",
      hosts: ["chatgpt.com", "chat.openai.com"],
      editorSelectors: ["#prompt-textarea", "textarea[data-id='root']", "[contenteditable='true'].ProseMirror"],
      composerSelectors: ["form"],
      sendSelectors: ["button[data-testid='send-button']", "button[aria-label*='Send']", "button[aria-label*='发送']"],
      conversationId(url) {
        return url.pathname.match(/^\/c\/([^/]+)/)?.[1] || (url.pathname === "/" ? "new" : url.pathname);
      }
    },
    {
      id: "claude",
      label: "Claude",
      hosts: ["claude.ai"],
      editorSelectors: ["div[contenteditable='true'].ProseMirror", "[contenteditable='true'][data-placeholder]", "fieldset [contenteditable='true']"],
      composerSelectors: ["fieldset", "form"],
      sendSelectors: ["button[aria-label*='Send']", "button[aria-label*='发送']", "button[data-testid*='send']"],
      conversationId(url) {
        return url.pathname.match(/^\/chat\/([^/]+)/)?.[1] || (url.pathname === "/new" ? "new" : url.pathname);
      }
    },
    {
      id: "doubao",
      label: "豆包",
      hosts: ["doubao.com"],
      editorSelectors: [
        "textarea[placeholder*='消息']",
        "textarea[placeholder*='输入']",
        "[contenteditable='true'][data-testid*='chat']",
        "[contenteditable='true'][class*='editor']",
        "[contenteditable='true'][role='textbox']",
        "textarea",
        "[contenteditable='true']"
      ],
      composerSelectors: ["[class*='chat-input']", "[class*='input-area']", "[class*='input-container']", "form"],
      sendSelectors: [
        "button[aria-label*='发送']",
        "button[data-testid*='send']",
        "button[class*='send']",
        "[role='button'][aria-label*='发送']"
      ],
      conversationId(url) {
        return url.pathname.match(/^\/chat\/([^/]+)/)?.[1]
          || url.searchParams.get("conversation_id")
          || (["/chat", "/chat/"].includes(url.pathname) ? "new" : url.pathname);
      }
    },
    {
      id: "gemini",
      label: "Gemini",
      hosts: ["gemini.google.com"],
      editorSelectors: [
        "rich-textarea .ql-editor.textarea[contenteditable='true']",
        "rich-textarea .ql-editor[contenteditable='true']",
        ".ql-editor.textarea[contenteditable='true']",
        ".ql-editor[contenteditable='true']",
        "[contenteditable='true'][role='textbox']",
        "textarea"
      ],
      composerSelectors: ["input-area-v2", "[class*='input-area']", "[class*='prompt-input']", "form"],
      sendSelectors: ["button[aria-label*='Send']", "button[aria-label*='发送']", "button.send-button", ".send-button"],
      conversationId(url) {
        return url.pathname.match(/^\/app\/([^/]+)/)?.[1] || (url.pathname === "/app" ? "new" : url.pathname);
      }
    },
    {
      id: "deepseek",
      label: "DeepSeek",
      hosts: ["chat.deepseek.com"],
      editorSelectors: ["textarea", "[contenteditable='true'][role='textbox']", "[contenteditable='true']"],
      composerSelectors: ["form", "[class*='input-area']", "[class*='chat-input']"],
      sendSelectors: ["button[aria-label*='Send']", "button[aria-label*='发送']", "button[class*='send']"],
      conversationId(url) {
        return url.pathname.match(/^\/a\/chat\/s\/([^/]+)/)?.[1] || url.pathname.match(/^\/chat\/([^/]+)/)?.[1] || (url.pathname === "/" ? "new" : url.pathname);
      }
    }
  ];

  const genericAdapter = {
    id: "generic",
    label: "通用 Chatbot",
    hosts: [],
    editorSelectors: GENERIC_SELECTORS,
    composerSelectors: ["form"],
    sendSelectors: [
      "button[type='submit']",
      "button[aria-label*='Send']",
      "button[aria-label*='发送']",
      "button[title*='Send']",
      "button[title*='发送']"
    ],
    conversationId(url) {
      const path = url.pathname.replace(/\/$/, "") || "/";
      return `${path}${url.hash && url.hash.length < 160 ? url.hash : ""}`;
    }
  };

  function parseUrl(value) {
    return value instanceof URL ? value : new URL(String(value));
  }

  function hostMatches(hostname, candidate) {
    return hostname === candidate || hostname.endsWith(`.${candidate}`);
  }

  function resolve(value) {
    const url = parseUrl(value);
    return adapters.find((adapter) => adapter.hosts.some((host) => hostMatches(url.hostname, host))) || genericAdapter;
  }

  function scope(adapter, value) {
    const url = parseUrl(value);
    return `${adapter.id}:${url.origin}:${adapter.conversationId(url)}`;
  }

  function isEditor(element) {
    if (!element || element.nodeType !== 1) return false;
    if (element.closest?.(".ps-vault-panel, .ps-restore-bar, .ps-picker-banner")) return false;
    const tag = element.tagName?.toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "input") return ["text", "search", ""].includes(element.type || "");
    return element.getAttribute?.("contenteditable") === "true" || element.getAttribute?.("role") === "textbox";
  }

  function editorFromTarget(target) {
    if (!target?.closest) return null;
    const candidate = target.closest("textarea, input[type='text'], [contenteditable='true'], [role='textbox']");
    return isEditor(candidate) ? candidate : null;
  }

  function isVisible(element) {
    if (!element?.isConnected) return false;
    const style = globalThis.getComputedStyle?.(element);
    if (style?.display === "none" || style?.visibility === "hidden") return false;
    const rect = element.getBoundingClientRect?.();
    return !rect || (rect.width > 8 && rect.height > 8);
  }

  function scoreEditor(element) {
    if (!isEditor(element) || !isVisible(element)) return -Infinity;
    const rect = element.getBoundingClientRect?.() || { width: 0, height: 0, bottom: 0, top: 0 };
    const viewportHeight = globalThis.innerHeight || 900;
    const text = `${element.getAttribute?.("placeholder") || ""} ${element.getAttribute?.("aria-label") || ""}`.toLocaleLowerCase();
    let score = 0;
    score += Math.min(rect.width || 0, 900) / 30;
    score += Math.min(rect.height || 0, 240) / 20;
    score += Math.max(0, 25 - Math.abs(viewportHeight - (rect.bottom || 0)) / 30);
    if (/message|prompt|ask|chat|消息|提问|输入|随便问/.test(text)) score += 35;
    if (/search|搜索|评论|comment|email|邮箱/.test(text)) score -= 45;
    if (element.closest?.("form")) score += 8;
    return score;
  }

  function safeQueryAll(documentRef, selector) {
    try {
      return Array.from(documentRef.querySelectorAll(selector));
    } catch (error) {
      return [];
    }
  }

  function findEditor(adapter, documentRef, manualSelector) {
    if (!documentRef) return null;
    if (manualSelector) {
      const manual = safeQueryAll(documentRef, manualSelector)[0];
      if (isEditor(manual) && isVisible(manual)) return manual;
    }
    const exactCandidates = [];
    for (const selector of adapter.editorSelectors || []) {
      for (const exact of safeQueryAll(documentRef, selector)) {
        if (isEditor(exact) && isVisible(exact) && !exactCandidates.includes(exact)) exactCandidates.push(exact);
      }
    }
    if (exactCandidates.length) return exactCandidates.sort((left, right) => scoreEditor(right) - scoreEditor(left))[0];
    const candidates = safeQueryAll(documentRef, GENERIC_SELECTORS.join(","));
    return candidates.filter(isEditor).sort((left, right) => scoreEditor(right) - scoreEditor(left))[0] || null;
  }

  function findComposerAnchor(adapter, editor) {
    if (!isEditor(editor)) return null;
    const ownerDocument = editor.ownerDocument || globalThis.document;
    for (const selector of adapter.composerSelectors || genericAdapter.composerSelectors) {
      try {
        const exact = editor.closest(selector);
        if (exact && exact !== ownerDocument?.body && exact !== ownerDocument?.documentElement) return exact;
      } catch (error) {
        // Ignore selectors invalidated by a host page update and continue with geometry.
      }
    }

    const editorRect = editor.getBoundingClientRect?.() || { width: 0, height: 0, bottom: 0 };
    let current = editor.parentElement;
    let best = current;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      if (current === ownerDocument?.body || current === ownerDocument?.documentElement) break;
      const rect = current.getBoundingClientRect?.();
      if (!rect) continue;
      const compact = rect.height <= Math.max(360, (editorRect.height || 0) + 220);
      const aligned = Math.abs((rect.bottom || 0) - (editorRect.bottom || 0)) < 120;
      const wideEnough = !editorRect.width || rect.width >= editorRect.width * 0.8;
      if (compact && aligned && wideEnough) best = current;
    }
    return best || editor.parentElement;
  }

  function isSendControl(adapter, target) {
    if (!target?.closest) return false;
    return (adapter.sendSelectors || genericAdapter.sendSelectors).some((selector) => {
      try {
        return Boolean(target.closest(selector));
      } catch (error) {
        return false;
      }
    });
  }

  function escapeCss(value) {
    if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char.codePointAt(0).toString(16)} `);
  }

  function selectorFor(element) {
    if (!isEditor(element)) return "";
    if (element.id) return `#${escapeCss(element.id)}`;
    for (const attribute of ["data-testid", "data-id", "aria-label", "name"]) {
      const value = element.getAttribute?.(attribute);
      if (value && value.length < 100) return `${element.tagName.toLowerCase()}[${attribute}="${String(value).replace(/"/g, '\\"')}"]`;
    }
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && parts.length < 5) {
      const tag = current.tagName.toLowerCase();
      const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((item) => item.tagName === current.tagName) : [];
      const part = siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})` : tag;
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  return {
    adapters,
    genericAdapter,
    editorFromTarget,
    findComposerAnchor,
    findEditor,
    isEditor,
    isSendControl,
    resolve,
    scope,
    scoreEditor,
    selectorFor
  };
});
