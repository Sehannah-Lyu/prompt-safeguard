const assert = require("node:assert/strict");
const Core = require("../core.js");

const first = Core.addHistoryVersion([], "第一版", 1000);
assert.equal(first.length, 1);
assert.equal(first[0].text, "第一版");

const unchanged = Core.addHistoryVersion(first, "第一版", 2000);
assert.equal(unchanged.length, 1, "相同内容不应创建新版本");

const changed = Core.addHistoryVersion(unchanged, "第二版", 3000);
assert.equal(changed.length, 2);
assert.equal(changed[1].createdAt, 3000);

let capped = [];
for (let index = 0; index < 110; index += 1) capped = Core.addHistoryVersion(capped, `版本 ${index}`, index);
assert.equal(capped.length, Core.MAX_HISTORY);
assert.equal(capped[0].text, "版本 10");

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
