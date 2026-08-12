# KnowTier v1.0.0 中文使用说明

KnowTier 是一款本地优先的 AI 学习助手。桌面版已经包含界面和本地服务，普通用户不需要
安装 Node.js、Python、Docker、PostgreSQL 或 Neo4j。

## 1. 下载与校验

从 [GitHub 最新正式版](https://github.com/Yangjunjie-Lin/KnowTier/releases/latest) 下载：

- Windows 日常安装：`KnowTier-Setup-1.0.0-windows-x64.exe`
- Windows 免安装：`KnowTier-Portable-1.0.0-windows-x64.zip`
- macOS Intel：`KnowTier-1.0.0-macOS-x64.dmg`
- Linux：`KnowTier-1.0.0-linux-x64.AppImage` 或 `knowtier_1.0.0_amd64.deb`

同时下载 `SHA256SUMS.txt` 和对应平台的签名状态文件。Windows 可用以下命令计算哈希：

```powershell
Get-FileHash .\KnowTier-Setup-1.0.0-windows-x64.exe -Algorithm SHA256
```

本版本没有代码签名证书时会明确附带 `UNSIGNED-<platform>.txt`。`UNSIGNED` 表示系统可能
弹出 SmartScreen 或 Gatekeeper 提示；哈希可以验证文件完整性，但不能证明发布者身份。

## 2. 安装与第一次启动

Windows 推荐运行安装包并按默认的“当前用户”方式安装。Portable 用户需要先完整解压 ZIP，
不要只复制主程序。macOS 用户打开 DMG 后拖入 Applications；Linux AppImage 需要先执行
`chmod +x`。

第一次启动时：

1. 选择中文或 English；
2. 创建学习空间；
3. 创建学习者；
4. 进入总览或学习空间。

默认使用离线 Mock Provider，不需要 API Key，也不会产生模型费用。它用于熟悉界面和验证
完整流程，不代表真实模型质量。

## 3. 推荐学习流程

1. 在“资料库”上传 TXT、Markdown、PDF、DOCX、PPTX 或支持的图片；
2. 等待摄取完成，检查知识蓝图、来源和部分成功提示；
3. 在“领域知识图谱”确认知识点和关系；
4. 在“学习空间”选择目标并对话；
5. 通过“学习状态”查看前置知识、误解、证据、来源和本轮变化；
6. 在“个人模型”“学生知识图谱”和“学习路径”查看长期学习状态；
7. 在“版本记录”检查领域与学生图谱的可追溯变化。

图谱默认把同一对实体的多个事实聚合为一条线。点击该线可查看关系本体、方向、置信度、
证据与历史；列表视图适合键盘操作和复杂图谱阅读。

## 4. 配置 SiliconFlow 或自定义模型

打开“设置 → 模型与供应商”。所有模型请求都由本地后端 ModelGateway 发出，前端不会直接
连接供应商。

### SiliconFlow

1. 供应商选择 SiliconFlow；
2. Base URL 保持 `https://api.siliconflow.cn/v1`；
3. 输入 API Key，选择“仅本次会话”或系统凭据库；
4. 点击“测试连接”；
5. 点击“刷新模型”，从 `/models` 动态发现的列表中选择；
6. 快速配置统一生成模型，或在高级映射中分别选择 Teacher、Extractor、Grader、Graph、
   Vision 和 Embedding；
7. 激活配置。

生成模型和 Embedding 模型能力不同，不要把普通 Chat 模型配置为 Embedding。页面顶部和资料/
图谱页面会显示当前实际运行的供应商与模型。

### 自定义 OpenAI-Compatible

自定义 Base URL 默认必须使用 HTTPS。只有明确启用“本地供应商”时，才允许连接 localhost
HTTP。连接失败时检查 Key、模型能力、Base URL、超时和供应商限流信息。

API Key 默认遮蔽，不写入 localStorage、URL、日志、Trace、截图、Git 或普通配置文件。删除
凭据后，依赖该凭据的配置不会静默切换到其他供应商。

## 5. 数据、备份、升级与卸载

用户数据位于：

- Windows：`%LOCALAPPDATA%\KnowTier`
- macOS：`~/Library/Application Support/KnowTier`
- Linux：`${XDG_DATA_HOME:-~/.local/share}/KnowTier`

其中包含 SQLite 数据库、上传资料、日志、升级备份和桌面状态。升级前程序会在需要迁移时创建
数据库备份。手动备份前应先完全退出 KnowTier，再复制整个目录。

卸载程序默认保留用户数据，防止误删学习记录。若需要彻底删除，请先卸载/删除程序，再手动
删除上述 App Data 目录。此操作不可恢复。

## 6. 常见问题

- **窗口黑屏或内容未出现**：完全退出后重新启动，确认已安装 Microsoft Edge WebView2
  Runtime；不要同时启动多个实例。
- **学生知识图谱为空**：先确认顶部知识点数量；点击“适配全图”，或切换列表/图谱视图。
  v1.0.0 已修复双节点同环导致画布空白的问题。
- **对话显示服务端错误**：在设置中重新测试连接，确认 Teacher 与 Embedding 分别选择了正确
  能力的模型；可暂时切回 Mock 验证本地链路。
- **429 或超时**：等待供应商限流恢复，降低 Max Tokens 或提高合理超时；重试不会重复提交
  同一条成功消息。
- **Portable 无法启动**：必须完整解压 ZIP，并保持主程序、Sidecar 和 WebView2Loader.dll 在
  原有目录结构中。
- **系统拦截未签名程序**：先从可信项目页核对 SHA-256 和 `UNSIGNED` 记录，再根据组织安全
  政策决定是否运行。

普通缺陷请按 [SUPPORT.md](../SUPPORT.md) 提供脱敏信息；安全问题请使用
[SECURITY.md](../SECURITY.md) 指定的 GitHub 私密报告入口。切勿公开 API Key、学习资料、数据库、
完整提示词或模型响应。
