(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PromptSafeguardSites = api;
})(globalThis, function () {
  "use strict";

  const INJECT_JS = ["core.js", "adapters.js", "content.js"];
  const INJECT_CSS = ["content.css"];
  const BUILT_IN_HOSTS = [
    "chatgpt.com", "chat.openai.com", "claude.ai", "gemini.google.com",
    "chat.deepseek.com", "doubao.com"
  ];

  function parseUrl(value) {
    return value instanceof URL ? value : new URL(String(value));
  }

  function canEnable(value) {
    try {
      return ["http:", "https:"].includes(parseUrl(value).protocol);
    } catch (error) {
      return false;
    }
  }

  function originPattern(value) {
    const url = parseUrl(value);
    return `${url.protocol}//${url.hostname}/*`;
  }

  function registrationId(value) {
    const origin = originPattern(value);
    let hash = 2166136261;
    for (let index = 0; index < origin.length; index += 1) {
      hash ^= origin.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `ps-site-${(hash >>> 0).toString(36)}`;
  }

  function siteLabel(value, registry = globalThis.PromptSafeguardAdapters) {
    const url = parseUrl(value);
    const adapter = registry?.resolve?.(url);
    return {
      adapterId: adapter?.id || "generic",
      label: adapter?.label || "通用 Chatbot",
      hostname: url.hostname,
      exact: Boolean(adapter && adapter.id !== "generic"),
      builtIn: BUILT_IN_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    };
  }

  return { BUILT_IN_HOSTS, INJECT_CSS, INJECT_JS, canEnable, originPattern, registrationId, siteLabel };
});
