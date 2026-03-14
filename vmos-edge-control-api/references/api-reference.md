# VMOS Edge Android Control Reference Index

按需加载时，先看这个索引，再只打开需要的模块文件。

## 先读哪一块

- 连接方式、支持性判断、`/base/version_info`、`/base/list_action`：
  - `references/connection-and-discovery.md`
- 结构化 UI 节点查找 / 操作：
  - `references/ui-node.md`
- 启动应用、安装、卸载、应用列表：
  - `references/activity-and-package.md`
- 点击、滑动、输入、按键：
  - `references/input-control.md`
- 截图、屏幕信息、`dump_compact`：
  - `references/observation.md`
- shell、剪贴板、Google 服务：
  - `references/system-and-device.md`

## 加载建议

- 如果用户没有明确给 IP，先检查本地是否存在 `cbs_go`；存在则默认 `127.0.0.1`
- 默认先查 `/base/version_info`
- `/base/version_info` 能成功返回，就视为当前环境支持 Control API
- 再用 `/base/list_action` 做能力发现
- 先取轻量接口列表，需要某个接口详细用法时，再按 `paths` 带 `detail=true`
- 只有在当前任务真的要调用某一类接口时，才打开对应模块文件
- 要把截图回给用户时，读取 `references/observation.md` 里的图片返回约定；OpenClaw 中 `MEDIA:` 必须从 exec/bash stdout 输出

## 连接规则

- 如果当前会话里同时安装了 `vmos-edge-container-api`：
  - 使用 `host_ip`
  - 路由是 `http://{host_ip}:18182/android_api/v2/{db_id}/{path}`
  - 调用前先通过 container API 解析目标 `db_id`
- 如果当前只有 `vmos-edge-control-api`：
  - 默认优先使用 `cloud_ip`
  - 路由是 `http://{cloud_ip}:18185/api/{path}`
  - 仅支持开启了局域网模式的云机
- 如果当前没有显式 IP，且本地没有 `cbs_go`，引导用户提供 `host_ip`、`cloud_ip`，或在已知宿主机场景下提供 `db_id`

## 默认约定

- 不要只凭 `version_name` 推断能力完整性；以 `supported_list` 与 `list_action` 为准
- 不要把旧版无障碍导出 / 查找接口写进默认流程
- 如需 MCP 集成，直接参考官方文档，不在本地 reference 中重复维护配置细节

## 官方文档

- <https://help.vmosedge.com/zh/sdk/agent-api.html>
- <https://help.vmosedge.com/zh/ai-reference/usage.html>
