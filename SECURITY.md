# 安全说明

## 报告安全问题

请不要为未修复的安全问题创建公开 Issue。请在 GitHub 仓库的 **Security → Report a vulnerability** 中提交私有报告：

https://github.com/JananZZZ/AiPin/security/advisories/new

报告中请包含受影响版本、复现条件、潜在影响和你已经尝试过的缓解方法。不要提交真实 API Key、私人对话或不必要的个人文件；如需说明，请使用最小化的脱敏样例。

## 支持范围

当前安全修复只面向最新公开的 alpha 版本。项目进入稳定发布后会在此处维护更细的版本支持表。

## 主要安全边界

- API Key 仅由 Rust 处理并存入 Windows Credential Manager。
- SQLite 和 `.aipin` 不保存 API Key。
- 远程 API 只允许 HTTPS，本机回环服务除外。
- 聊天 POST 禁止重定向，认证头不得跨 origin。
- Markdown 按不可信内容清洗，禁止远程脚本和原始 HTML。
- 默认没有遥测、远程配置和自动崩溃上传。

会话数据库和附件没有额外的应用级加密，依赖 Windows 用户权限和 BitLocker 等磁盘加密。
