# VMOS Edge Android Control API Reference

基于官方 Android Control API 文档与 AI 快速参考整理，适合作为 agent 的本地速查表。

## 兼容性

- Android 10: `vcloud_android10_edge_20260110` 及以上
- Android 13: `vcloud_android13_edge_20260110` 及以上
- Android 15: `vcloud_android15_edge_20260110` 及以上
- CBS: `1.1.1.10` 及以上
- 如需 MCP 集成，请参考官方文档第 6 节；MCP 需要 API `1.0.7+`
- `version_info`、`sleep`: 镜像版本 `20260113+`
- 不要只凭 `version_name` 推断能力完整性；以 `supported_list` 与 `list_action` 为准
- 当前 skill 约定把 `/accessibility/dump`、`/accessibility/find_and_operate`、`/accessibility/find_node` 视为过时接口，不纳入默认流程
- 这个 skill 的控制入口是 `cloud_ip`
- 如果你手里只有 `host_ip`，应先使用 `vmos-edge-container-api`

## 调用方式

- 云机内 HTTP:
  - `http://{cloud_ip}:18185/api/{path}`
  - 推荐作为默认执行路径
  - 如果 `GET /base/version_info` 连不上、超时，或直接返回 `5xx`，说明当前云机没有暴露 Control API
- MCP:
  - 当前 skill 默认不依赖 MCP
  - 如需 MCP 接入，请直接参考官方文档，不在本地 reference 中重复维护配置细节

### HTTP 快速模板

```bash
BASE_URL="http://${VMOS_EDGE_CLOUD_IP}:18185/api"
curl -s "$BASE_URL/base/version_info"
```

```bash
BASE_URL="http://${VMOS_EDGE_CLOUD_IP}:18185/api"
curl -s -X POST "$BASE_URL/activity/start" \
  -H "Content-Type: application/json" \
  -d '{"package_name":"com.android.settings"}'
```

## 命名兼容

- 文档里的接口路径是 `/input/click` 这种格式。
- 部分 MCP 客户端会把它规范化为 `input_click`、`base_version_info` 这类工具名。
- 以 `supported_list`、`list_action` 或客户端实际暴露的工具名为准。

## 通用响应

```json
{
  "code": 200,
  "data": {},
  "msg": "OK",
  "request_id": "..."
}
```

## 基础能力

### 获取 API 版本

- `GET /base/version_info`
- 返回 `version_name`、`version_code`、`supported_list`

### 查询接口清单

- `POST /base/list_action`
- 参数:
  - `paths`: 可选，接口路径数组
  - `detail`: 可选，是否返回详情

建议：

- 第一次连接时先查 `GET /base/version_info`
- 再查 `POST /base/list_action`
- 用实际返回判断当前设备属于哪一类能力集合：
  - 截图型：有 `screenshot/format`、`screenshot/raw`、`screenshot/data_url`
  - 紧凑层级型：有 `accessibility/dump_compact`
  - 元信息型：只有 `display/info`、`activity/top_activity`、`package/list` 这类接口

### 暂停响应

- `POST /base/sleep`
- 参数:
  - `duration`: 毫秒

### 多步执行说明

- 多步动作请按普通接口逐步执行并逐步验证

## 应用与安装

### 启动应用

- `POST /activity/start`
- 参数:
  - `package_name`

### 启动指定 Activity

- `POST /activity/start_activity`
- 参数:
  - `package_name`
  - `class_name`
  - `action`
  - `data`
  - `extras`

### 停止应用

- `POST /activity/stop`
- 参数:
  - `package_name`

### 安装应用文件

- `POST /package/install_sync`
- 说明:
  - 支持 `apk`、`apks`、`apkm`、`xapk`

### 通过 URI 安装

- `POST /package/install_uri_sync`
- 参数:
  - `uri`

### 卸载应用

- `POST /package/uninstall`
- 参数:
  - `package_name`
  - `keep_data`: 可选

### 获取已安装应用

- `GET /package/list`
- 常见查询:
  - `GET /package/list?type=user`
  - `GET /package/list?type=system`

## 输入控制

### 点击

- `POST /input/click`
- 参数:
  - `x`
  - `y`

### 多击

- `POST /input/multi_click`
- 参数:
  - `x`
  - `y`
  - `times`
  - `interval`

### 输入文本

- `POST /input/text`
- 参数:
  - `text`

### 按键

- `POST /input/keyevent`
- 参数:
  - `key_code`
  - `key_codes`

### 直线滑动

- `POST /input/swipe`
- 参数:
  - `start_x`
  - `start_y`
  - `end_x`
  - `end_y`
  - `duration`
  - `up_delay`

### 曲线滑动

- `POST /input/scroll_bezier`
- 参数:
  - `start_x`
  - `start_y`
  - `end_x`
  - `end_y`
  - `duration`
  - `up_delay`
  - `clear_fling`

## 屏幕与紧凑层级观察

### 获取屏幕信息

- `GET /display/info`

### 截图接口

- 常见截图接口：
  - `GET /screenshot/format`
  - `GET /screenshot/raw`
  - `GET /screenshot/data_url`
- 注意：
  - 不是所有设备都会暴露完整截图族接口
  - 即使 `version_name` 较新，也要以 `supported_list` / `list_action` 为准
  - 某些旧文档里会写成其他截图路径，实际调用时以当前设备返回为准

### 导出紧凑层级

- `GET /accessibility/dump_compact`
- 适合没有截图接口时快速观察当前界面

### 旧接口提醒

- `GET /accessibility/dump`
- `POST /accessibility/find_and_operate`
- `POST /accessibility/find_node`
- 以上接口在当前 skill 里都视为过时能力，只用于识别旧设备历史行为，不再作为默认观察或交互链路

## 系统与辅助能力

### Shell

- `POST /system/shell`
- 参数:
  - `command`
  - `as_root`: 可选

### 剪贴板

- `POST /clipboard/set`
- `GET /clipboard/get`
- `GET /clipboard/list`
- `POST /clipboard/clear`

### Google 服务

- `POST /google/set_enabled`
- `POST /google/reset_gaid`
- `GET /google/get_enabled`

## Agent 常用组合

### 进入页面并完成点击

1. `/base/version_info`
2. `/base/list_action`
3. 如果支持截图接口，优先走 `/screenshot/format`、`/screenshot/data_url` 或 `/screenshot/raw`
4. 否则走 `/accessibility/dump_compact`
5. 结合截图或 `dump_compact` 里的文本与 `bounds`，规划 `/input/click`、`/input/swipe`、`/input/text`
6. 用当前设备支持的观察接口再次验证

### 安装并启动应用

1. `/package/install_sync` 或 `/package/install_uri_sync`
2. `/package/list`
3. `/activity/start`
4. 用 `/activity/top_activity`、`package/list` 或当前可用的观察接口验证

## 更多接口

完整官方文档：

- <https://help.vmosedge.com/zh/sdk/agent-api.html>
- <https://help.vmosedge.com/zh/ai-reference/usage.html>
