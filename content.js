(() => {
  "use strict";

  const Core = globalThis.PromptSafeguardCore;
  const Adapters = globalThis.PromptSafeguardAdapters;
  if (!Core || !Adapters || globalThis.__PROMPT_SAFEGUARD_V3__) return;
  globalThis.__PROMPT_SAFEGUARD_V3__ = true;

  const LIBRARY_KEY = "prompt-safeguard:library:v2";
  const HISTORY_PREFIX = "prompt-safeguard:history:";
  const DRAFT_PREFIX = "prompt-safeguard:draft:";
  const SITE_CONFIG_PREFIX = "prompt-safeguard:site-config:";

  let editor = null;
  let adapter = Adapters.resolve(location.href);
  let manualSelector = "";
  let trigger = null;
  let panel = null;
  let restoreBar = null;
  let pickerBanner = null;
  let highlightedCandidate = null;
  let dirtySinceAttach = false;
  let pendingSubmit = false;
  let lastDraftText = null;
  let observer = null;
  let scanQueued = false;
  let attachedScope = "";
  let saveInterval = null;
  let ui = {
    tab: "history",
    query: "",
    folderId: "all",
    view: "list",
    editingPromptId: null,
    draftContent: "",
    variablePromptId: null
  };

  function contextPath() {
    adapter = Adapters.resolve(location.href);
    return Adapters.scope(adapter, location.href);
  }

  function legacyContextPath() {
    const url = new URL(location.href);
    return `${url.origin}${url.pathname}`;
  }

  function historyKey() {
    return `${HISTORY_PREFIX}${contextPath()}`;
  }

  function draftKey() {
    return `${DRAFT_PREFIX}${contextPath()}`;
  }

  function legacyHistoryKey() {
    return `${HISTORY_PREFIX}${legacyContextPath()}`;
  }

  function legacyDraftKey() {
    return `${DRAFT_PREFIX}${legacyContextPath()}`;
  }

  function siteConfigKey() {
    return `${SITE_CONFIG_PREFIX}${location.origin}`;
  }

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (result) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(result);
      });
    });
  }

  function storageSet(value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(value, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  }

  function storageRemove(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(key, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  }

  function readEditor() {
    if (!editor) return "";
    return "value" in editor ? editor.value : editor.innerText || "";
  }

  function notifyEditor(text) {
    editor?.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text
    }));
  }

  function replaceEditor(text) {
    if (!editor) return;
    editor.focus();
    if ("value" in editor) {
      const prototype = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      setter ? setter.call(editor, text) : (editor.value = text);
    } else {
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, text);
    }
    notifyEditor(text);
  }

  function insertEditor(text) {
    if (!editor) return;
    editor.focus();
    if ("value" in editor) {
      const start = editor.selectionStart ?? editor.value.length;
      const end = editor.selectionEnd ?? start;
      editor.setRangeText(text, start, end, "end");
    } else {
      document.execCommand("insertText", false, text);
    }
    notifyEditor(text);
  }

  // Keep extension UI out of the host site's composer DOM. Several chat sites
  // use a Flex/Grid composer; inserting a sibling there can squeeze the editor.
  function positionComposerDock() {
    if (!trigger?.isConnected && !restoreBar?.isConnected) return;
    const anchor = Adapters.findComposerAnchor(adapter, editor) || editor;
    const rect = anchor?.getBoundingClientRect?.();
    if (!rect) return;

    const gutter = 12;
    const width = Math.max(180, Math.min(rect.width || 768, 768, window.innerWidth - gutter * 2));
    const left = Math.max(gutter, Math.min(rect.left || gutter, window.innerWidth - width - gutter));
    const triggerHeight = trigger?.offsetHeight || 28;
    const triggerTop = Math.max(gutter, Math.min((rect.top || gutter) - triggerHeight - 8, window.innerHeight - triggerHeight - gutter));

    if (trigger?.isConnected) Object.assign(trigger.style, { left: `${left}px`, top: `${triggerTop}px`, width: `${width}px` });
    if (restoreBar?.isConnected) {
      const restoreHeight = restoreBar.offsetHeight || 54;
      Object.assign(restoreBar.style, { left: `${left}px`, top: `${Math.max(gutter, triggerTop - restoreHeight - 8)}px`, width: `${width}px` });
    }
  }

  function mountAboveComposer(element) {
    if (!element?.isConnected) document.body.appendChild(element);
    window.requestAnimationFrame(positionComposerDock);
  }

  function setProtectionStatus(label, state = "ready") {
    const status = trigger?.querySelector(".ps-trigger-status");
    if (status) status.textContent = label;
    if (trigger) trigger.dataset.state = state;
  }

  async function saveSnapshot() {
    if (!editor?.isConnected) return;
    const text = readEditor();

    if (!text.trim()) {
      if (dirtySinceAttach) {
        await Promise.all([storageRemove(draftKey()), storageRemove(legacyDraftKey())]);
        lastDraftText = "";
        setProtectionStatus("输入框为空", "ready");
      }
      return;
    }

    try {
      const keys = [historyKey(), draftKey(), legacyHistoryKey(), legacyDraftKey()];
      const stored = await storageGet(keys);
      const history = Array.isArray(stored[historyKey()])
        ? stored[historyKey()]
        : (Array.isArray(stored[legacyHistoryKey()]) ? stored[legacyHistoryKey()] : []);
      const nextHistory = Core.addHistoryVersion(history, text);
      const changed = nextHistory.length !== history.length || nextHistory.at(-1)?.id !== history.at(-1)?.id;
      const updates = {};
      if (changed) updates[historyKey()] = nextHistory;
      if (text !== lastDraftText && stored[draftKey()]?.text !== text) {
        updates[draftKey()] = { text, updatedAt: Date.now() };
      }
      if (Object.keys(updates).length) await storageSet(updates);
      lastDraftText = text;
      dirtySinceAttach = false;
      setProtectionStatus(changed ? `已保存版本 ${nextHistory.length}` : "内容无变化", changed ? "saved" : "ready");
      if (panel?.dataset.open === "true" && ui.tab === "history" && ui.view === "list") renderBody();
    } catch (error) {
      setProtectionStatus("保存失败", "error");
    }
  }

  async function clearActiveDraft() {
    try {
      await Promise.all([storageRemove(draftKey()), storageRemove(legacyDraftKey())]);
      lastDraftText = "";
      dirtySinceAttach = false;
      restoreBar?.remove();
      restoreBar = null;
      setProtectionStatus("已发送，历史保留", "ready");
    } catch (error) {
      setProtectionStatus("清理失败", "error");
    }
  }

  function showRestoreBar(draft) {
    if (!draft?.text || restoreBar?.isConnected || !editor) return;
    restoreBar = document.createElement("aside");
    restoreBar.className = "ps-restore-bar";
    restoreBar.innerHTML = `
      <span class="ps-restore-mark">✦</span>
      <span class="ps-restore-copy">
        <strong>发现未发送的草稿</strong>
        <small>${draft.text.length} 个字符 · ${formatTime(draft.updatedAt)} 保存</small>
      </span>
      <button class="ps-mini-primary" data-action="recover" type="button">恢复</button>
      <button class="ps-icon-button" data-action="dismiss-recovery" type="button" aria-label="关闭">×</button>`;
    restoreBar.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "recover") {
        replaceEditor(draft.text);
        restoreBar.remove();
        restoreBar = null;
      }
      if (action === "dismiss-recovery") {
        restoreBar.remove();
        restoreBar = null;
      }
    });
    mountAboveComposer(restoreBar);
  }

  async function loadRecovery() {
    try {
      const stored = await storageGet([draftKey(), legacyDraftKey()]);
      const draft = stored[draftKey()] || stored[legacyDraftKey()];
      if (!stored[draftKey()] && draft?.text) await storageSet({ [draftKey()]: draft });
      lastDraftText = draft?.text ?? null;
      if (draft?.text && !readEditor().trim()) showRestoreBar(draft);
    } catch (error) {
      setProtectionStatus("无法读取草稿", "error");
    }
  }

  function ensureTrigger() {
    if (!editor) return;
    if (!trigger?.isConnected) {
      trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "ps-vault-trigger";
      trigger.dataset.state = "ready";
      trigger.setAttribute("aria-label", "打开 Prompt 工作台");
      trigger.innerHTML = `
        <span class="ps-trigger-glyph">P</span>
        <span class="ps-trigger-name">Prompt Vault</span>
        <span class="ps-trigger-status">${adapter.label} · 每 5 秒自动保存</span>
        <span class="ps-trigger-arrow">↗</span>`;
      trigger.addEventListener("click", togglePanel);
    }
    mountAboveComposer(trigger);
  }

  function ensurePanel() {
    if (panel?.isConnected) return;
    panel = document.createElement("section");
    panel.className = "ps-vault-panel";
    panel.dataset.open = "false";
    panel.setAttribute("aria-label", "Prompt Vault 工作台");
    panel.innerHTML = `
      <header class="ps-panel-header">
        <div>
          <span class="ps-panel-kicker">PROMPT SAFEGUARD</span>
          <h2>Prompt Vault</h2>
        </div>
        <div class="ps-panel-tools">
          <span class="ps-site-pill">${adapter.label}</span>
          <button class="ps-icon-button ps-pick-editor" type="button" aria-label="重新选择输入框" title="重新选择输入框">⌖</button>
          <button class="ps-icon-button ps-panel-close" type="button" aria-label="关闭">×</button>
        </div>
      </header>
      <nav class="ps-panel-tabs" aria-label="Prompt Vault 导航">
        <button class="ps-tab is-active" data-tab="history" type="button">历史记录</button>
        <button class="ps-tab" data-tab="library" type="button">常用 Prompt</button>
      </nav>
      <label class="ps-search-wrap">
        <span>⌕</span>
        <input class="ps-search" type="search" placeholder="搜索版本或 Prompt" autocomplete="off" />
      </label>
      <div class="ps-panel-body"></div>`;
    document.body.appendChild(panel);
    panel.querySelector(".ps-panel-close").addEventListener("click", closePanel);
    panel.querySelector(".ps-pick-editor").addEventListener("click", startPicker);
    panel.querySelector(".ps-search").addEventListener("input", (event) => {
      ui.query = event.target.value;
      ui.view = "list";
      renderBody();
    });
    panel.querySelector(".ps-panel-tabs").addEventListener("click", (event) => {
      const tab = event.target.closest("[data-tab]")?.dataset.tab;
      if (!tab) return;
      ui.tab = tab;
      ui.view = "list";
      panel.querySelectorAll(".ps-tab").forEach((item) => item.classList.toggle("is-active", item.dataset.tab === tab));
      renderBody();
    });
    panel.querySelector(".ps-panel-body").addEventListener("click", handleBodyClick);
    panel.querySelector(".ps-panel-body").addEventListener("submit", handleBodySubmit);
  }

  function togglePanel() {
    ensurePanel();
    const nextOpen = panel.dataset.open !== "true";
    panel.dataset.open = String(nextOpen);
    trigger?.setAttribute("aria-expanded", String(nextOpen));
    if (nextOpen) renderBody();
  }

  function openPanel() {
    ensurePanel();
    panel.dataset.open = "true";
    trigger?.setAttribute("aria-expanded", "true");
    renderBody();
  }

  function closePanel() {
    if (panel) panel.dataset.open = "false";
    trigger?.setAttribute("aria-expanded", "false");
  }

  async function loadLibrary() {
    const stored = await storageGet(LIBRARY_KEY);
    return Core.normalizeLibrary(stored[LIBRARY_KEY]);
  }

  async function saveLibrary(library) {
    await storageSet({ [LIBRARY_KEY]: Core.normalizeLibrary(library) });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      "\"": "&quot;"
    })[char]);
  }

  function formatTime(timestamp) {
    return new Date(timestamp || Date.now()).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }

  function formatDate(timestamp) {
    const date = new Date(timestamp || Date.now());
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return "今天";
    return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  }

  function preview(text, max = 116) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    return clean.length > max ? `${clean.slice(0, max)}…` : clean;
  }

  async function renderBody() {
    if (!panel?.isConnected) return;
    const body = panel.querySelector(".ps-panel-body");
    body.innerHTML = `<div class="ps-loading">正在整理你的 Prompt…</div>`;
    try {
      if (ui.view === "prompt-form") return renderPromptForm(body);
      if (ui.view === "folder-form") return renderFolderForm(body);
      if (ui.view === "variables") return renderVariableForm(body);
      if (ui.tab === "history") return renderHistory(body);
      return renderLibrary(body);
    } catch (error) {
      body.innerHTML = `<div class="ps-empty"><strong>暂时无法读取数据</strong><span>${escapeHtml(error.message)}</span></div>`;
    }
  }

  async function loadHistoryVersions() {
    const stored = await storageGet([historyKey(), legacyHistoryKey()]);
    return Array.isArray(stored[historyKey()])
      ? stored[historyKey()]
      : (Array.isArray(stored[legacyHistoryKey()]) ? stored[legacyHistoryKey()] : []);
  }

  async function renderHistory(body) {
    const versions = await loadHistoryVersions();
    const keyword = ui.query.trim().toLocaleLowerCase();
    const filtered = versions.filter((version) => !keyword || version.text.toLocaleLowerCase().includes(keyword)).reverse();
    const cards = filtered.map((version, index) => `
      <article class="ps-history-card ${index === 0 ? "is-latest" : ""}">
        <div class="ps-timeline-dot"></div>
        <div class="ps-card-meta">
          <span>${formatDate(version.createdAt)} · ${formatTime(version.createdAt)}</span>
          ${index === 0 ? "<em>最新版本</em>" : ""}
        </div>
        <p>${escapeHtml(preview(version.text))}</p>
        <div class="ps-card-actions">
          <button data-action="restore-history" data-id="${version.id}" type="button">恢复到输入框</button>
          <button data-action="history-to-library" data-id="${version.id}" type="button">存为常用</button>
        </div>
      </article>`).join("");
    body.innerHTML = `
      <div class="ps-section-heading">
        <div><strong>当前对话的版本</strong><span>${versions.length} 个版本 · 有变化时每 5 秒保存</span></div>
        <button class="ps-outline-button" data-action="snapshot-now" type="button">立即保存</button>
      </div>
      <div class="ps-history-list">${cards || `<div class="ps-empty"><strong>还没有历史版本</strong><span>开始输入，5 秒后第一个版本会出现在这里。</span></div>`}</div>`;
  }

  async function renderLibrary(body) {
    const library = await loadLibrary();
    const prompts = Core.searchPrompts(library.prompts, ui.query, ui.folderId);
    const folderButtons = [
      `<button class="ps-folder-chip ${ui.folderId === "all" ? "is-active" : ""}" data-action="select-folder" data-id="all" type="button">全部</button>`,
      ...library.folders.map((folder) => `<button class="ps-folder-chip ${ui.folderId === folder.id ? "is-active" : ""}" data-action="select-folder" data-id="${folder.id}" type="button">${escapeHtml(folder.name)}</button>`)
    ].join("");
    const cards = prompts.map((prompt) => {
      const variables = Core.extractVariables(prompt.content);
      const folder = library.folders.find((item) => item.id === prompt.folderId);
      return `
        <article class="ps-prompt-card">
          <div class="ps-prompt-card-top"><span>${escapeHtml(folder?.name || "未分类")}</span>${variables.length ? `<em>${variables.length} 个变量</em>` : ""}</div>
          <h3>${escapeHtml(prompt.title)}</h3>
          <p>${escapeHtml(preview(prompt.content, 128))}</p>
          <div class="ps-card-actions">
            <button class="is-primary" data-action="use-prompt" data-id="${prompt.id}" type="button">使用</button>
            <button data-action="edit-prompt" data-id="${prompt.id}" type="button">编辑</button>
            <button data-action="delete-prompt" data-id="${prompt.id}" type="button">删除</button>
          </div>
        </article>`;
    }).join("");
    body.innerHTML = `
      <div class="ps-section-heading">
        <div><strong>Prompt 收藏夹</strong><span>${library.prompts.length} 条常用 Prompt</span></div>
        <button class="ps-solid-button" data-action="new-prompt" type="button">＋ 新建</button>
      </div>
      <div class="ps-folder-row">${folderButtons}<button class="ps-folder-add" data-action="new-folder" type="button">＋ 文件夹</button></div>
      <div class="ps-prompt-grid">${cards || `<div class="ps-empty"><strong>这里还空着</strong><span>创建一条常用 Prompt，或从历史版本保存。</span></div>`}</div>`;
  }

  async function renderPromptForm(body) {
    const library = await loadLibrary();
    const prompt = library.prompts.find((item) => item.id === ui.editingPromptId);
    const content = prompt?.content ?? ui.draftContent ?? "";
    const options = library.folders.map((folder) => `<option value="${folder.id}" ${prompt?.folderId === folder.id ? "selected" : ""}>${escapeHtml(folder.name)}</option>`).join("");
    body.innerHTML = `
      <form class="ps-editor-form" data-form="prompt">
        <div class="ps-form-heading"><button class="ps-back-button" data-action="back-to-library" type="button">←</button><div><strong>${prompt ? "编辑 Prompt" : "新建 Prompt"}</strong><span>变量使用双花括号，例如 {{产品名称}}</span></div></div>
        <label><span>名称</span><input name="title" required maxlength="80" value="${escapeHtml(prompt?.title || "")}" placeholder="例如：周报润色" /></label>
        <label><span>文件夹</span><select name="folderId">${options}</select></label>
        <label><span>Prompt 内容</span><textarea name="content" required rows="10" placeholder="输入 Prompt；需要替换的内容写成 {{变量名}}">${escapeHtml(content)}</textarea></label>
        <div class="ps-form-footer"><button class="ps-outline-button" data-action="back-to-library" type="button">取消</button><button class="ps-solid-button" type="submit">保存 Prompt</button></div>
      </form>`;
  }

  function renderFolderForm(body) {
    body.innerHTML = `
      <form class="ps-editor-form" data-form="folder">
        <div class="ps-form-heading"><button class="ps-back-button" data-action="back-to-library" type="button">←</button><div><strong>新建文件夹</strong><span>把相似用途的 Prompt 收在一起。</span></div></div>
        <label><span>文件夹名称</span><input name="name" required maxlength="40" autofocus placeholder="例如：内容创作" /></label>
        <div class="ps-form-footer"><button class="ps-outline-button" data-action="back-to-library" type="button">取消</button><button class="ps-solid-button" type="submit">创建文件夹</button></div>
      </form>`;
  }

  async function renderVariableForm(body) {
    const library = await loadLibrary();
    const prompt = library.prompts.find((item) => item.id === ui.variablePromptId);
    if (!prompt) {
      ui.view = "list";
      return renderLibrary(body);
    }
    const variables = Core.extractVariables(prompt.content);
    const fields = variables.map((name) => `<label><span>${escapeHtml(name)}</span><input name="${escapeHtml(name)}" required placeholder="填写 ${escapeHtml(name)}" /></label>`).join("");
    body.innerHTML = `
      <form class="ps-editor-form" data-form="variables">
        <div class="ps-form-heading"><button class="ps-back-button" data-action="back-to-library" type="button">←</button><div><strong>${escapeHtml(prompt.title)}</strong><span>填好变量后插入当前输入框。</span></div></div>
        ${fields}
        <div class="ps-template-preview">${escapeHtml(preview(prompt.content, 240))}</div>
        <div class="ps-form-footer"><button class="ps-outline-button" data-action="back-to-library" type="button">取消</button><button class="ps-solid-button" type="submit">填充并插入</button></div>
      </form>`;
  }

  async function handleBodyClick(event) {
    const control = event.target.closest("[data-action]");
    if (!control) return;
    const { action, id } = control.dataset;
    if (action === "snapshot-now") return saveSnapshot();
    if (action === "select-folder") {
      ui.folderId = id;
      return renderBody();
    }
    if (action === "new-folder") {
      ui.view = "folder-form";
      return renderBody();
    }
    if (action === "new-prompt") {
      ui.view = "prompt-form";
      ui.editingPromptId = null;
      ui.draftContent = "";
      return renderBody();
    }
    if (action === "back-to-library") {
      ui.tab = "library";
      ui.view = "list";
      ui.draftContent = "";
      return renderBody();
    }

    if (action === "restore-history" || action === "history-to-library") {
      const versions = await loadHistoryVersions();
      const version = versions.find((item) => item.id === id);
      if (!version) return;
      if (action === "restore-history") {
        replaceEditor(version.text);
        closePanel();
        return;
      }
      ui.tab = "library";
      ui.view = "prompt-form";
      ui.editingPromptId = null;
      ui.draftContent = version.text;
      panel.querySelectorAll(".ps-tab").forEach((item) => item.classList.toggle("is-active", item.dataset.tab === "library"));
      return renderBody();
    }

    const library = await loadLibrary();
    const prompt = library.prompts.find((item) => item.id === id);
    if (action === "edit-prompt" && prompt) {
      ui.view = "prompt-form";
      ui.editingPromptId = id;
      ui.draftContent = "";
      return renderBody();
    }
    if (action === "delete-prompt" && prompt) {
      if (!confirm(`删除“${prompt.title}”？`)) return;
      library.prompts = library.prompts.filter((item) => item.id !== id);
      await saveLibrary(library);
      return renderBody();
    }
    if (action === "use-prompt" && prompt) {
      const variables = Core.extractVariables(prompt.content);
      if (!variables.length) {
        insertEditor(prompt.content);
        closePanel();
        return;
      }
      ui.variablePromptId = id;
      ui.view = "variables";
      return renderBody();
    }
  }

  async function handleBodySubmit(event) {
    event.preventDefault();
    const form = event.target;
    const formType = form.dataset.form;
    const data = new FormData(form);
    if (formType === "folder") {
      const library = await loadLibrary();
      const name = String(data.get("name") || "").trim();
      if (!name) return;
      const folder = { id: Core.makeId("folder"), name, createdAt: Date.now() };
      library.folders.push(folder);
      await saveLibrary(library);
      ui.folderId = folder.id;
      ui.view = "list";
      return renderBody();
    }
    if (formType === "prompt") {
      const library = await loadLibrary();
      const payload = {
        title: String(data.get("title") || "").trim(),
        folderId: String(data.get("folderId") || "inbox"),
        content: String(data.get("content") || ""),
        updatedAt: Date.now()
      };
      const index = library.prompts.findIndex((item) => item.id === ui.editingPromptId);
      if (index >= 0) library.prompts[index] = { ...library.prompts[index], ...payload };
      else library.prompts.unshift({ id: Core.makeId("prompt"), createdAt: Date.now(), ...payload });
      await saveLibrary(library);
      ui.view = "list";
      ui.editingPromptId = null;
      ui.draftContent = "";
      return renderBody();
    }
    if (formType === "variables") {
      const library = await loadLibrary();
      const prompt = library.prompts.find((item) => item.id === ui.variablePromptId);
      if (!prompt) return;
      const values = {};
      Core.extractVariables(prompt.content).forEach((name) => { values[name] = data.get(name); });
      insertEditor(Core.fillVariables(prompt.content, values));
      closePanel();
    }
  }

  function submitted() {
    if (!editor || !readEditor().trim()) return;
    pendingSubmit = true;
    window.setTimeout(() => {
      if (pendingSubmit && !readEditor().trim()) clearActiveDraft();
      pendingSubmit = false;
    }, 400);
  }

  function clearPicker() {
    highlightedCandidate?.classList.remove("ps-editor-candidate");
    highlightedCandidate = null;
    pickerBanner?.remove();
    pickerBanner = null;
    document.removeEventListener("pointermove", handlePickerMove, true);
    document.removeEventListener("click", handlePickerClick, true);
    document.removeEventListener("keydown", handlePickerKey, true);
  }

  function handlePickerMove(event) {
    const candidate = Adapters.editorFromTarget(event.target);
    if (candidate === highlightedCandidate) return;
    highlightedCandidate?.classList.remove("ps-editor-candidate");
    highlightedCandidate = candidate;
    highlightedCandidate?.classList.add("ps-editor-candidate");
  }

  async function handlePickerClick(event) {
    const candidate = Adapters.editorFromTarget(event.target) || highlightedCandidate;
    if (!candidate) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const selector = Adapters.selectorFor(candidate);
    if (!selector) return;
    manualSelector = selector;
    await storageSet({
      [siteConfigKey()]: {
        manualSelector,
        adapterId: adapter.id,
        updatedAt: Date.now()
      }
    });
    clearPicker();
    editor = null;
    attach(candidate);
    setProtectionStatus("已记住此输入框", "saved");
  }

  function handlePickerKey(event) {
    if (event.key === "Escape") clearPicker();
  }

  function startPicker() {
    closePanel();
    clearPicker();
    pickerBanner = document.createElement("aside");
    pickerBanner.className = "ps-picker-banner";
    pickerBanner.innerHTML = `<span class="ps-picker-glyph">⌖</span><span><strong>选择聊天输入框</strong><small>移动鼠标并点击目标输入框 · Esc 取消</small></span>`;
    document.body.appendChild(pickerBanner);
    document.addEventListener("pointermove", handlePickerMove, true);
    document.addEventListener("click", handlePickerClick, true);
    document.addEventListener("keydown", handlePickerKey, true);
  }

  function scanForEditor() {
    scanQueued = false;
    adapter = Adapters.resolve(location.href);
    const candidate = Adapters.findEditor(adapter, document, manualSelector);
    if (candidate) attach(candidate);
  }

  function scheduleScan() {
    if (scanQueued) return;
    scanQueued = true;
    window.requestAnimationFrame(scanForEditor);
  }

  function scheduleDockPosition() {
    window.requestAnimationFrame(positionComposerDock);
  }

  function handleDocumentClick(event) {
    if (Adapters.isSendControl(adapter, event.target)) submitted();
  }

  function attach(candidate) {
    if (!candidate) return;
    const nextScope = contextPath();
    if (candidate !== editor) {
      editor = candidate;
      dirtySinceAttach = false;
      editor.addEventListener("input", () => {
        dirtySinceAttach = true;
        pendingSubmit = false;
        setProtectionStatus("等待自动保存…", "typing");
      });
      editor.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) submitted();
      });
      editor.closest("form")?.addEventListener("submit", submitted);
    }
    if (attachedScope !== nextScope) {
      attachedScope = nextScope;
      dirtySinceAttach = false;
      loadRecovery();
    }
    ensureTrigger();
    ensurePanel();
  }

  function teardown() {
    observer?.disconnect();
    if (saveInterval) window.clearInterval(saveInterval);
    document.removeEventListener("click", handleDocumentClick, true);
    window.removeEventListener("resize", scheduleDockPosition);
    window.removeEventListener("scroll", scheduleDockPosition, true);
    clearPicker();
    trigger?.remove();
    panel?.remove();
    restoreBar?.remove();
    trigger = null;
    panel = null;
    restoreBar = null;
    globalThis.__PROMPT_SAFEGUARD_V3__ = false;
  }

  async function initialize() {
    const stored = await storageGet(siteConfigKey());
    manualSelector = stored[siteConfigKey()]?.manualSelector || "";
    scanForEditor();
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("click", handleDocumentClick, true);
    window.addEventListener("resize", scheduleDockPosition, { passive: true });
    window.addEventListener("scroll", scheduleDockPosition, { passive: true, capture: true });
    saveInterval = window.setInterval(saveSnapshot, 5000);
  }

  const ready = initialize();
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message?.type?.startsWith("ps-")) return undefined;
    ready.then(() => {
      if (message.type === "ps-open") openPanel();
      if (message.type === "ps-pick-editor") startPicker();
      if (message.type === "ps-disable") teardown();
      sendResponse({ ok: true, adapter: adapter.id });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
