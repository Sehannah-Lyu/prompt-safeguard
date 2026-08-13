const assert = require("node:assert/strict");
const Core = require("../core.js");

const first = Core.addHistoryVersion([], "请分析这份用户访谈并总结痛点", 1000);
assert.equal(first.groups.length, 1);
assert.equal(first.groups[0].versions[0].text, "请分析这份用户访谈并总结痛点");

const unchanged = Core.addHistoryVersion(first, "请分析这份用户访谈并总结痛点", 2000);
assert.equal(Core.flattenHistory(unchanged).length, 1, "相同内容不应创建新版本");

const similar = Core.addHistoryVersion(unchanged, "请分析这份用户访谈并总结核心痛点", 3000);
assert.equal(similar.groups.length, 1, "连续的相似版本应折叠为一组");
assert.equal(Core.flattenHistory(similar).at(-1).createdAt, 3000);

const different = Core.addHistoryVersion(similar, "为咖啡品牌设计一个增长方案", 4000);
assert.equal(different.groups.length, 2, "差异明显的版本应创建新组");

assert.ok(Core.textSimilarity("总结用户访谈中的核心痛点", "总结用户访谈中的核心痛点与机会") > Core.SIMILARITY_THRESHOLD);
assert.ok(Core.textSimilarity("总结用户访谈中的核心痛点", "设计咖啡品牌增长方案") < Core.SIMILARITY_THRESHOLD);

let compacted = [];
const base = "请帮我分析用户访谈并总结核心痛点、用户证据、使用场景和产品机会";
for (let index = 0; index < 18; index += 1) {
  compacted = Core.addHistoryVersion(compacted, `${base}，补充说明 ${String(index).padStart(2, "0")}`, index + 1);
}
assert.equal(compacted.groups.length, 1);
assert.ok(compacted.groups[0].versions.length <= Core.MAX_GROUP_VERSIONS, "每组最多保留 10 个版本");
assert.equal(compacted.groups[0].versions[0].createdAt, 1, "组内首版应优先作为里程碑保留");
assert.deepEqual(
  compacted.groups[0].versions.slice(-3).map((item) => item.createdAt),
  [16, 17, 18],
  "最新 3 个版本必须无条件保留"
);
assert.ok(compacted.groups[0].discardedCount > 0, "应记录已整理的细微快照数量");

const manyGroups = [];
for (let index = 0; index < 25; index += 1) {
  manyGroups.push({ id: `v${index}`, text: `主题${String.fromCharCode(0x4e00 + index).repeat(40)}`, createdAt: index + 1 });
}
const grouped = Core.normalizeHistory(manyGroups);
assert.equal(grouped.groups.length, Core.MAX_GROUPS, "每个对话最多保留最近 20 个版本组");
assert.equal(grouped.groups.at(-1).updatedAt, 25);

const migrated = Core.normalizeHistory([
  { id: "old-1", text: "旧格式中的第一版访谈分析", createdAt: 10 },
  { id: "old-2", text: "旧格式中的第一版访谈分析，补充痛点", createdAt: 20 }
]);
assert.equal(migrated.schemaVersion, Core.HISTORY_SCHEMA_VERSION);
assert.equal(Core.flattenHistory(migrated).length, 2, "旧数组历史应迁移为分组结构");

const recentConversations = Core.selectRecentConversations(
  Array.from({ length: 25 }, (_, index) => ({ scope: `chat-${index}`, updatedAt: index + 1 }))
);
assert.equal(recentConversations.length, Core.MAX_CONVERSATIONS);
assert.equal(recentConversations[0].scope, "chat-24");
assert.equal(recentConversations.at(-1).scope, "chat-5");

assert.deepEqual(
  Core.extractVariables("为 {{产品}} 写一篇给 {{受众}} 的文章，再次提到 {{产品}}"),
  ["产品", "受众"]
);
assert.equal(
  Core.fillVariables("为 {{产品}} 写给 {{受众}}", { 产品: "咖啡机", 受众: "新手" }),
  "为 咖啡机 写给 新手"
);

const normalized = Core.normalizeLibrary({
  folders: [{ id: "writing", name: "写作" }],
  prompts: [{ id: "p1", title: "文章", content: "写一篇文章", folderId: "writing" }]
});
assert.equal(normalized.folders[0].id, "inbox");
assert.equal(normalized.prompts[0].folderId, "writing");
assert.equal(Core.searchPrompts(normalized.prompts, "文章", "writing").length, 1);
assert.equal(Core.searchPrompts(normalized.prompts, "文章", "inbox").length, 0);

console.log("Prompt Safeguard core tests passed");
