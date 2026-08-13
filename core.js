(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PromptSafeguardCore = api;
})(globalThis, function () {
  "use strict";

  const HISTORY_SCHEMA_VERSION = 2;
  const MAX_CONVERSATIONS = 20;
  const MAX_GROUPS = 20;
  const MAX_GROUP_VERSIONS = 10;
  const RECENT_VERSIONS = 3;
  const MAX_MILESTONES = 7;
  const SIMILARITY_THRESHOLD = 0.82;
  const MILESTONE_DIFFERENCE = 0.12;

  function makeId(prefix = "item") {
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${Date.now().toString(36)}-${random}`;
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[\p{P}\p{S}\s]+/gu, "")
      .trim();
  }

  function shingles(value, size = 2) {
    const text = normalizeText(value);
    if (text.length <= size) return text ? [text] : [];
    const result = [];
    for (let index = 0; index <= text.length - size; index += 1) result.push(text.slice(index, index + size));
    return result;
  }

  function textSimilarity(left, right) {
    const a = normalizeText(left);
    const b = normalizeText(right);
    if (a === b) return a ? 1 : 0;
    if (!a || !b) return 0;
    const lengthRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    if (lengthRatio < 0.45) return 0;
    const counts = new Map();
    for (const item of shingles(a)) counts.set(item, (counts.get(item) || 0) + 1);
    let overlap = 0;
    const rightShingles = shingles(b);
    for (const item of rightShingles) {
      const count = counts.get(item) || 0;
      if (!count) continue;
      overlap += 1;
      counts.set(item, count - 1);
    }
    const dice = (2 * overlap) / (shingles(a).length + rightShingles.length);
    return dice * 0.85 + lengthRatio * 0.15;
  }

  function normalizeVersion(value) {
    if (!value || typeof value.text !== "string" || !value.text.trim()) return null;
    return {
      id: value.id || makeId("version"),
      text: value.text,
      createdAt: Number(value.createdAt) || Date.now()
    };
  }

  function selectMilestones(versions, limit = MAX_MILESTONES) {
    if (versions.length <= limit) return versions.slice();
    const selected = [versions[0]];
    const remaining = versions.slice(1);
    while (selected.length < limit && remaining.length) {
      let bestIndex = -1;
      let bestDifference = -1;
      remaining.forEach((candidate, index) => {
        const nearestSimilarity = Math.max(...selected.map((item) => textSimilarity(item.text, candidate.text)));
        const difference = 1 - nearestSimilarity;
        if (difference > bestDifference) {
          bestDifference = difference;
          bestIndex = index;
        }
      });
      if (bestIndex < 0 || bestDifference < MILESTONE_DIFFERENCE) break;
      selected.push(remaining.splice(bestIndex, 1)[0]);
    }
    return selected.sort((a, b) => a.createdAt - b.createdAt);
  }

  function compactGroup(group) {
    const versions = (Array.isArray(group?.versions) ? group.versions : [])
      .map(normalizeVersion).filter(Boolean).sort((a, b) => a.createdAt - b.createdAt);
    const deduped = versions.filter((item, index) => !index || item.text !== versions[index - 1].text);
    if (deduped.length <= MAX_GROUP_VERSIONS) {
      return { ...group, versions: deduped, discardedCount: Number(group?.discardedCount) || 0 };
    }
    const recent = deduped.slice(-RECENT_VERSIONS);
    const milestones = selectMilestones(deduped.slice(0, -RECENT_VERSIONS));
    const kept = [...milestones, ...recent].sort((a, b) => a.createdAt - b.createdAt);
    return {
      ...group,
      versions: kept,
      discardedCount: (Number(group?.discardedCount) || 0) + deduped.length - kept.length
    };
  }

  function createGroup(version) {
    return {
      id: makeId("group"),
      createdAt: version.createdAt,
      updatedAt: version.createdAt,
      discardedCount: 0,
      versions: [version]
    };
  }

  function groupVersions(versions) {
    const groups = [];
    for (const rawVersion of Array.isArray(versions) ? versions : []) {
      const version = normalizeVersion(rawVersion);
      if (!version) continue;
      const lastGroup = groups.at(-1);
      const lastVersion = lastGroup?.versions?.at(-1);
      if (lastVersion && textSimilarity(lastVersion.text, version.text) >= SIMILARITY_THRESHOLD) {
        lastGroup.versions.push(version);
        lastGroup.updatedAt = version.createdAt;
      } else {
        groups.push(createGroup(version));
      }
    }
    return groups.map(compactGroup).slice(-MAX_GROUPS);
  }

  function flattenHistory(value) {
    if (Array.isArray(value)) return value.map(normalizeVersion).filter(Boolean);
    return (Array.isArray(value?.groups) ? value.groups : [])
      .flatMap((group) => Array.isArray(group?.versions) ? group.versions : [])
      .map(normalizeVersion).filter(Boolean).sort((a, b) => a.createdAt - b.createdAt);
  }

  function normalizeHistory(value) {
    const groups = Array.isArray(value?.groups)
      ? value.groups.map((group) => compactGroup({
          ...group,
          id: group?.id || makeId("group"),
          createdAt: Number(group?.createdAt) || Number(group?.versions?.[0]?.createdAt) || Date.now(),
          updatedAt: Number(group?.updatedAt) || Number(group?.versions?.at?.(-1)?.createdAt) || Date.now()
        })).filter((group) => group.versions.length).slice(-MAX_GROUPS)
      : groupVersions(value);
    return {
      schemaVersion: HISTORY_SCHEMA_VERSION,
      groups,
      updatedAt: groups.at(-1)?.updatedAt || 0
    };
  }

  function selectRecentConversations(entries, limit = MAX_CONVERSATIONS) {
    return (Array.isArray(entries) ? entries : [])
      .slice()
      .sort((left, right) => (Number(right?.updatedAt) || 0) - (Number(left?.updatedAt) || 0))
      .slice(0, limit);
  }

  function addHistoryVersion(history, text, createdAt = Date.now()) {
    const model = normalizeHistory(history);
    const cleanText = String(text || "");
    if (!cleanText.trim()) return model;
    const latest = model.groups.at(-1)?.versions?.at(-1);
    if (latest?.text === cleanText) return model;
    const version = normalizeVersion({ text: cleanText, createdAt });
    const lastGroup = model.groups.at(-1);
    if (lastGroup?.versions?.length && textSimilarity(lastGroup.versions.at(-1).text, cleanText) >= SIMILARITY_THRESHOLD) {
      lastGroup.versions.push(version);
      lastGroup.updatedAt = version.createdAt;
      model.groups[model.groups.length - 1] = compactGroup(lastGroup);
    } else {
      model.groups.push(createGroup(version));
      model.groups = model.groups.slice(-MAX_GROUPS);
    }
    model.updatedAt = version.createdAt;
    return model;
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
    HISTORY_SCHEMA_VERSION,
    MAX_CONVERSATIONS,
    MAX_GROUPS,
    MAX_GROUP_VERSIONS,
    RECENT_VERSIONS,
    MAX_MILESTONES,
    SIMILARITY_THRESHOLD,
    addHistoryVersion,
    flattenHistory,
    groupVersions,
    normalizeHistory,
    selectRecentConversations,
    textSimilarity,
    createDefaultLibrary,
    extractVariables,
    fillVariables,
    makeId,
    normalizeLibrary,
    searchPrompts
  };
});
