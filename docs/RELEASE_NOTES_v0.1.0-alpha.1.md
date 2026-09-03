# AiPin v0.1.0-alpha.1

这是 AiPin 的第一个公开 alpha 版本。

AiPin 把一个输入窗和多个独立 AI 会话窗放在同一个 Windows 工作区中。你可以一次发送问题，并排观察不同模型的流式回答、推理内容、Markdown、公式和代码。

## 这次包含

- 最多 17 个模型窗加 1 个输入窗。
- OpenAI、DeepSeek、Kimi、MiniMax、GLM、MiMo、硅基流动和自定义兼容端点。
- 流式输出、单窗停止、队列、独立上下文和历史恢复。
- 智能网格、自由缩放、窗格锁定、输入窗三态。
- 图片输入、提示词注入、输入历史。
- 独立设置窗口、实时主题、透明度、字体和圆角。
- 配置与会话数据的独立或完整导入导出。

## 下载

下载附件中的 `AiPin.exe` 后直接运行，不需要安装。AiPin 支持 Windows 10 22H2 与 Windows 11 x64，并需要 WebView2 Evergreen Runtime。

## 隐私

API Key 保存在 Windows Credential Manager。会话和附件保存在 `%LOCALAPPDATA%\AiPin`。请求从本机直接发送给你选择的供应商，没有 AiPin 中转服务器，也没有默认遥测。

## 请留意

这是 alpha 版本，尚未进行 Authenticode 签名。Windows 可能显示 SmartScreen 提示。会话数据库没有额外应用级加密，请结合 Windows 用户权限与 BitLocker 使用。
