---
name: vmos-edge-control-api
description: Use this skill when controlling a VMOS Edge Android cloud phone through the Android Control API via the cloud machine IP (`cloud_ip`). Covers direct in-guest HTTP access, capability detection, hierarchy inspection, element interaction, typing, installs, and the Observe -> Plan -> Act -> Verify workflow. Do not use this skill for host_ip-based container routing.
---

# VMOS Edge Android Control

在需要通过 VMOS Edge Android Control API 控制单台安卓云机时使用这个 skill。MCP 是可选加速通道，不是前置依赖。

## 核心流程

- 始终遵循 `Observe -> Plan -> Act -> Verify`
- 先探测当前设备实际暴露的能力，再决定观察和操作方式
- 优先元素定位，最后才退回坐标
- 每个关键动作后都重新获取当前设备支持的观察结果

## 连接信息

默认优先走云机内 HTTP：

- Base URL: `http://{cloud_ip}:18185/api`

拿连接信息时按这个顺序：

1. 读取环境变量
   - `VMOS_EDGE_CLOUD_IP`
2. 读取当前提示词里已经替换好的值
3. 如果还缺失，再向用户询问 `cloud_ip` 或完整控制地址
4. 如果用户给的是 `host_ip`，说明这属于 `vmos-edge-container-api` 的入口，不要继续追问 `db_id`

只有在客户端已经配好 MCP 时，才把 MCP 当成可选捷径。
本仓库不提供 MCP 配置模板；如需 MCP 集成，统一参考官方文档。

## 兼容性

- Android 10: `vcloud_android10_edge_20260110` 及以上
- Android 13: `vcloud_android13_edge_20260110` 及以上
- Android 15: `vcloud_android15_edge_20260110` 及以上
- CBS: `1.1.1.10` 及以上
- 云机内 HTTP 不依赖 MCP
- MCP 可选，要求 API `1.0.7+`
- `version_info`、`sleep` 属于增强能力，需要镜像 `20260113+`

## 传输方式优先级

1. 云机内 HTTP
   - `http://{cloud_ip}:18185/api/{path}`
2. MCP
   - 仅当当前客户端已配置好时使用
3. WebSocket / `ve`
   - 仅在用户明确偏好这些方式时使用

## 默认策略

- 能直接发 HTTP 请求时，优先 `/usr/bin/curl`、`fetch`、Python `requests` 之类的方式调用 API
- 如果 shell 里 `curl` 不在 PATH，不要卡住，直接改用 `/usr/bin/curl` 或 Python
- `cloud_ip` 本身就足够发起控制请求，不要再额外要求 `db_id`
- 如果用户给的是 `host_ip`，应切到 `vmos-edge-container-api`，不要把 `host_ip` 当成 `cloud_ip`
- 第一次连接时，优先请求 `/base/version_info`
- 如果 `http://{cloud_ip}:18185/api/base/version_info` 连不上、超时，或直接返回 `5xx`，应明确说明当前云机没有暴露 Control API，不要回退去追问 `host_ip` 或 `db_id`
- 然后请求 `/base/list_action`，不要只凭版本号假设能力完整
- 当前项目内约定把 `/accessibility/dump`、`/accessibility/find_and_operate`、`/accessibility/find_node` 视为过时接口，不纳入默认流程
- 观察优先级：
  - 如果支持 `screenshot/format`、`screenshot/raw` 或 `screenshot/data_url` 这类截图接口，优先截图
  - 否则优先 `/accessibility/dump_compact`
  - 如果两者都没有，再组合 `/display/info`、`/activity/top_activity`、`/package/list`
- 坐标动作前先看 `/display/info`
- 交互优先级：
  - 默认根据截图或 `dump_compact` 里的文本、`bounds`、层级顺序规划点击和滑动
  - 点击、滑动优先 `/input/click`、`/input/swipe`、`/input/scroll_bezier`
  - 只有当前设备暴露了更新的高层 UI 操作能力时，才按 `supported_list` / `list_action` 使用
- 输入优先 `/input/text`
- 启动应用优先 `/activity/start`
- 安装优先 `/package/install_sync` 或 `/package/install_uri_sync`
- 连续动作按 `Observe -> Plan -> Act -> Verify` 逐步执行，不使用聚合式批量动作
- 没有专用接口时才考虑 `/system/shell`

## 必读参考

- 需要精确路径、参数名、示例请求时，必须读取 `references/api-reference.md`

## 安全边界

- 删除应用、清数据、系统设置、权限修改、shell 操作前先确认用户意图
- 没有明确要求时，不要改时区、语言、国家、Google 状态、设备信息、定位或传感器
