# AiPin v0.1.0-alpha.1 公开版本审计记录

审计日期：2026-09-03  
目标平台：Windows 10 22H2 / Windows 11 x64  
审计范围：源码构建、前端与 Rust 测试、严格静态检查、真实 EXE 运行、供应商请求、公开媒体、敏感信息边界和 Release 产物。

## 自动化验证

- `npm test -- --run`：4 个测试文件、18 项测试全部通过。
- `npm run build`：TypeScript 检查与 Vite production build 通过。
- `cargo fmt --check`：通过。
- `cargo clippy --all-targets -- -D warnings`：通过。
- `cargo test`：14 项 Rust 测试全部通过，文档测试通过。
- 布局测试包含 10,000 组随机拖动、边界、锁定和尺寸守恒用例。
- Rust 测试覆盖 OpenAI Responses、DeepSeek、Kimi、MiniMax、硅基流动参数映射，联网能力字段，附件校验，HTTPS 边界和脱敏导出。

Windows 链接器会输出本地化的“正在创建库”提示，并被新版 Rust 作为 `linker_messages` warning 展示；Clippy 与测试退出码均为 0，不是源码告警。

## 真实 AiPin.exe 验证

公开截图和五组 GIF 全部来自实际运行的 `AiPin.exe`，页面来源为 Tauri 的 `tauri.localhost` WebView2，而不是 Vite 浏览器预览。采集脚本会：

1. 在忽略目录 `.tooling/` 临时备份当前应用快照。
2. 保留真实模型配置和 Credential Manager 密钥引用，但用无隐私的演示会话替换可见内容。
3. 由真实 EXE 向本机已配置的 DeepSeek、Kimi 与硅基流动端点并发发出同一条安全演示问题。
4. 捕获流式占位、状态灯、Markdown、公式、表格、代码、布局变化和独立设置窗同步。
5. 结束后恢复原会话、模型启用状态、布局、主题、透明度、置顶和锁定状态，并删除临时备份。

本轮真实调用中，4 个演示目标均生成完成。预检时另一次 MiniMax 流返回了正文但缺少完成事件，AiPin 按设计保留正文并标记为不完整；公开首页演示没有把该供应商偶发行为伪装成正常完成。

## 公开媒体验收

- `chat-streaming.gif`：真实多模型并发、生成占位、呼吸状态和逐步输出。
- `layout-workspace.gif`：真实窗口缩放、输入窗三态、分割线与窗格锁定。
- `appearance-live.gif`：真实主窗与设置窗并排，主题、透明度、字号、行距和圆角实时同步。
- `models-and-providers.gif`：真实模型列表与模型设置页，不进入 API Key 编辑区。
- `history-and-data.gif`：真实历史、提示词与数据迁移页面。

单个 GIF 最大约 5.3 MiB，五组 GIF 总体约 11 MiB。截图只包含 AiPin 窗口；模型页仅显示“Key 已配置”，不显示完整 Key。原始帧与媒体工具位于被忽略的项目目录，不进入 Git。

## 安全与公开边界

- API Key 由 Rust 写入 Windows Credential Manager，React 状态和 SQLite 只保留 `secretRef`/配置状态。
- 供应商请求只由 Rust 发出；远程 HTTP 被拒绝，HTTP 只允许 loopback。
- 配置、数据和完整 `.aipin` 导出均不携带 API Key。
- `.gitignore` 排除 `.aipin`、数据库、附件、日志、环境文件、证书、WebView 数据、构建目录、Release 目录、原始帧和媒体工具。
- 发布前对待提交文本、Git 文件清单、媒体关键帧和最终 EXE 继续执行密钥特征扫描。
- 没有遥测、远程配置或自动崩溃上传。

## Release 产物

- 版本：`v0.1.0-alpha.1`
- 文件：`release/AiPin.exe`
- 大小：18,679,808 bytes
- SHA-256：`EB7581A62A43D73E9DD5C97672CF873462121A9E3A5123FFB6464BCF982450E6`
- 交付形式：单个便携 EXE；系统 WebView2 Runtime 与 Windows 系统组件除外。

当前未进行 Authenticode 签名，Windows 可能显示 SmartScreen 提示。仓库中的 EXE 只作为 GitHub Release 附件发布，不进入 Git 历史。

## 仍需持续覆盖的矩阵

- Win10 干净虚拟机、双实体显示器热插拔、RDP、睡眠恢复与企业系统代理。
- 所有供应商的全部模型族、地区、账户层级、余额不足和限流事件。
- 17 个真实付费模型连续生成 30 分钟的成本受控压力测试；当前布局与流式并发边界主要由本地自动化覆盖。
- 未签名版本的 SmartScreen 体验；正式稳定版建议使用可信证书和时间戳。

这份记录只描述本轮可复现结果，不使用“绝对稳定”或“完美无缺”等无法持续证明的结论。
