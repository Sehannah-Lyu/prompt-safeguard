(() => {
  "use strict";

  const Sites = globalThis.PromptSafeguardSites;
  const Adapters = globalThis.PromptSafeguardAdapters;
  const elements = {
    adapter: document.querySelector("#site-adapter"),
    mode: document.querySelector("#site-mode"),
    host: document.querySelector("#site-host"),
    description: document.querySelector("#site-description"),
    status: document.querySelector("#permission-status"),
    statusCopy: document.querySelector("#status-copy"),
    primary: document.querySelector("#primary-action"),
    pick: document.querySelector("#pick-editor"),
    disable: document.querySelector("#disable-site"),
    message: document.querySelector("#message")
  };

  let tab = null;
  let enabled = false;
  let site = null;

  function setMessage(message = "") {
    elements.message.textContent = message;
  }

  function setBusy(busy) {
    elements.primary.disabled = busy;
    elements.pick.disabled = busy;
    elements.disable.disabled = busy;
  }

  async function hasPermission(url) {
    return chrome.permissions.contains({ origins: [Sites.originPattern(url)] });
  }

  async function registerSite(url) {
    const id = Sites.registrationId(url);
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [id] });
    await chrome.scripting.registerContentScripts([{
      id,
      matches: [Sites.originPattern(url)],
      js: Sites.INJECT_JS,
      css: Sites.INJECT_CSS,
      runAt: "document_idle",
      persistAcrossSessions: true
    }]);
  }

  async function injectCurrentTab() {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: Sites.INJECT_CSS });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: Sites.INJECT_JS });
  }

  async function sendToTab(type) {
    try {
      return await chrome.tabs.sendMessage(tab.id, { type });
    } catch (error) {
      await injectCurrentTab();
      return chrome.tabs.sendMessage(tab.id, { type });
    }
  }

  function render() {
    elements.adapter.textContent = site.label;
    elements.mode.textContent = site.exact ? "精确适配" : "通用检测";
    elements.host.textContent = site.hostname;
    elements.description.textContent = site.exact
      ? `已内置 ${site.label} 输入框与对话识别规则。`
      : "启用后会自动检测聊天输入框，也可以手动选择。";
    elements.status.dataset.state = enabled ? "enabled" : "disabled";
    elements.statusCopy.textContent = site.builtIn ? "内置支持 · 已自动启用" : (enabled ? "当前网站已启用" : "当前网站尚未授权");
    elements.primary.textContent = enabled ? "打开 Prompt Vault" : "在此网站启用";
    elements.primary.disabled = false;
    elements.pick.hidden = !enabled;
    elements.disable.hidden = !enabled || site.builtIn;
  }

  async function enableSite() {
    setBusy(true);
    setMessage();
    try {
      const granted = await chrome.permissions.request({ origins: [Sites.originPattern(tab.url)] });
      if (!granted) {
        setMessage("未获得网站权限，插件不会读取当前页面。");
        return;
      }
      await registerSite(tab.url);
      await injectCurrentTab();
      enabled = true;
      render();
      await sendToTab("ps-open");
    } catch (error) {
      elements.status.dataset.state = "error";
      elements.statusCopy.textContent = "启用失败";
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function disableSite() {
    setBusy(true);
    setMessage();
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "ps-disable" }).catch(() => undefined);
      await chrome.scripting.unregisterContentScripts({ ids: [Sites.registrationId(tab.url)] }).catch(() => undefined);
      await chrome.permissions.remove({ origins: [Sites.originPattern(tab.url)] });
      enabled = false;
      render();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function initialize() {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !Sites.canEnable(tab.url)) {
      elements.adapter.textContent = "不可用页面";
      elements.host.textContent = "请打开一个 Chatbot 网站";
      elements.description.textContent = "浏览器内部页面和扩展商店页面不能注入插件。";
      elements.status.dataset.state = "error";
      elements.statusCopy.textContent = "当前页面无法启用";
      elements.primary.textContent = "不可用";
      return;
    }
    site = Sites.siteLabel(tab.url, Adapters);
    enabled = site.builtIn || await hasPermission(tab.url);
    if (enabled && !site.builtIn) await registerSite(tab.url);
    render();
  }

  elements.primary.addEventListener("click", () => enabled ? sendToTab("ps-open") : enableSite());
  elements.pick.addEventListener("click", async () => {
    await sendToTab("ps-pick-editor");
    window.close();
  });
  elements.disable.addEventListener("click", disableSite);
  initialize().catch((error) => {
    elements.status.dataset.state = "error";
    elements.statusCopy.textContent = "初始化失败";
    setMessage(error.message);
  });
})();
