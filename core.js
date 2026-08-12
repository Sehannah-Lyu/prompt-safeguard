(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PromptSafeguardCore = api;
})(globalThis, function () {
  "use strict";

  const MAX_HISTORY = 100;

  function makeId(prefix = "item") {
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${Date.now().toString(36)}-${random}`;
  }

  function addHistoryVersion(history, text, createdAt = Date.now()) {
    const cleanText = String(text || "");
    const versions = Array.isArray(history) ? history.slice() : [];
    if (!cleanText.trim()) return versions;
    if (versions.at(-1)?.text === cleanText) return versions;
    versions.push({ id: makeId("version"), text: cleanText, createdAt });
    return versions.slice(-MAX_HISTORY);
  }

  function extractVariables(template) {
    const found = [];
    const seen = new Set();
    String(template || "").replace(/{{\s*([^{}]+?)\s*}}/g, (_, name) => {
      const cleanName = name.trim();
      if (cleanName && !seen.has(cleanName)) {
        seen.add(cleanName);
        found.push(cleanName);
      }
      return _;
    });
    return found;
  }

  function fillVariables(template, values) {
    return String(template || "").replace(/{{\s*([^{}]+?)\s*}}/g, (match, name) => {
      const value = values?.[name.trim()];
      return value == null ? match : String(value);
    });
  }

  function createDefaultLibrary() {
    return {
      folders: [{ id: "inbox", name: "未分类", createdAt: Date.now() }],
      prompts: []
    };
  }

  function normalizeLibrary(value) {
    const fallback = createDefaultLibrary();
    if (!value || typeof value !== "object") return fallback;
    const folders = Array.isArray(value.folders) ? value.folders.filter((item) => item?.id && item?.name) : [];
    if (!folders.some((folder) => folder.id === "inbox")) folders.unshift(fallback.folders[0]);
    const folderIds = new Set(folders.map((folder) => folder.id));
    const prompts = Array.isArray(value.prompts)
      ? value.prompts.filter((item) => item?.id && typeof item.content === "string").map((item) => ({
          ...item,
          title: item.title || "未命名 Prompt",
          folderId: folderIds.has(item.folderId) ? item.folderId : "inbox"
        }))
      : [];
    return { folders, prompts };
  }

  function searchPrompts(prompts, query, folderId = "all") {
    const keyword = String(query || "").trim().toLocaleLowerCase();
    return (Array.isArray(prompts) ? prompts : []).filter((prompt) => {
      const inFolder = folderId === "all" || prompt.folderId === folderId;
      const haystack = `${prompt.title || ""}\n${prompt.content || ""}`.toLocaleLowerCase();
      return inFolder && (!keyword || haystack.includes(keyword));
    });
  }

  return {
    MAX_HISTORY,
    addHistoryVersion,
    createDefaultLibrary,
    extractVariables,
    fillVariables,
    makeId,
    normalizeLibrary,
    searchPrompts
  };
});
