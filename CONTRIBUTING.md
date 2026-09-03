# 参与 AiPin

谢谢你愿意花时间了解 AiPin。无论是报告一个细小的不顺手、补充供应商兼容性，还是提交一段代码，都很有价值。

## 开始之前

1. 阅读 [README](README.md)、[技术架构与 Agent 指南](docs/ARCHITECTURE_AND_AGENT_GUIDE.md)、[产品原则](PRODUCT.md) 和 [设计规范](DESIGN.md)。
2. 搜索已有 Issue，避免重复工作。
3. 涉及较大产品行为、数据库格式或供应商协议时，先创建 Issue 说明方案。
4. 不要在 Issue、截图、日志、测试或提交中包含 API Key、真实对话、附件和本机绝对路径。

## 本地开发

```powershell
npm ci
.\scripts\dev.ps1
```

浏览器模式可用于界面开发，但只提供本地演示流：

```powershell
npm run dev
```

## 提交前检查

```powershell
npm test
npm run build
cargo fmt --manifest-path src-tauri\Cargo.toml -- --check
cargo test --manifest-path src-tauri\Cargo.toml
cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets -- -D warnings
```

如果改动涉及 Windows 窗口、托盘、Credential Manager、真实网络或 DPI，请同时描述你实际验证过的 Windows 环境。

## 提交和 Pull Request

- 每个提交聚焦一个清楚的问题。
- 提交说明建议使用 `feat:`、`fix:`、`docs:`、`test:`、`refactor:` 或 `chore:` 前缀。
- Pull Request 请说明问题、实现方式、测试结果、界面变化和剩余风险。
- UI 改动请附前后截图；截图不得包含密钥或个人数据。
- 新增供应商或模型能力时，请附官方文档链接和请求 fixture，明确哪些字段是确认支持、明确不支持或未知。

## 设计方向

AiPin 的界面应该安静、紧凑、可预测。请保持极细边框、克制圆角和高对比正文，不加入聊天气泡、渐变、发光、宽阴影或只在鼠标悬停时才能完成的关键操作。

提交代码即表示你同意按项目的 [MIT License](LICENSE) 发布该贡献。
