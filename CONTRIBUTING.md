# 参与贡献

感谢你关注 Prompt Safeguard。当前最有价值的贡献是站点适配反馈和可复现的兼容性问题。

## 提交 Issue

请尽量提供：

- Chatbot 名称和页面 URL（不要包含私人对话内容）；
- 浏览器及版本；
- 插件版本；
- 预期行为与实际行为；
- 可复现步骤；
- 页面改版相关截图，截图前请隐藏敏感 Prompt。

## 本地验证

修改前后请运行：

```powershell
node --check core.js
node --check adapters.js
node --check content.js
node --check popup.js
node tests\core.test.js
node tests\adapters.test.js
node tests\content-layout.test.js
node tests\exact-adapter-contract.test.js
node tests\manifest.test.js
```

## 新增站点适配器

1. 在 `adapters.js` 中新增站点配置；
2. 优先使用稳定的语义属性，避免依赖构建产物中的随机 class；
3. 提供对话 ID 解析规则；
4. 在 `tests/adapters.test.js` 和 `tests/adapter-harness.html` 中补充用例；
5. 确保自动识别失败时仍可使用通用检测或手动选框。

请不要在 Issue、测试文件或提交记录中包含真实 Prompt、Cookie、访问令牌或账号信息。
