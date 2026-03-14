---
name: vmos-edge-container-api
description: Use this skill when managing VMOS Edge cloud phone containers through the Container API via the host machine IP (`host_ip`). Covers host queries, instance lifecycle, db_id/cloud_ip lookup, batch operations, app distribution, and async polling. If no IP is provided and local `cbs_go` is running, default `host_ip` to `127.0.0.1`. Use it to resolve `db_id` when `vmos-edge-control-api` needs host_ip-based routing.
---

# VMOS Edge Container Management

在需要通过 VMOS Edge Container API 管理云手机实例时使用这个 skill。

## 核心流程

- 始终遵循 `Query -> Plan -> Execute -> Verify`
- Base URL 是 `http://{host_ip}:18182`
- 如果用户已经明确给了 `host_ip`，优先使用用户给的值
- 如果用户没有明确给 IP，先检查本地是否存在 `cbs_go` 进程；存在则默认 `host_ip=127.0.0.1`
- 如果用户没有明确给 IP，且本地没有 `cbs_go`，引导用户提供 `host_ip`
- 只接 `host_ip`；如果用户给的是 `cloud_ip`，应切到 `vmos-edge-control-api`
- 本地检查 `cbs_go` 时，优先用精确匹配，例如 `pgrep -x cbs_go >/dev/null 2>&1`
- 主机健康先查 `GET /v1/heartbeat`、`GET /v1/systeminfo`
- 实例列表优先 `POST /container_api/v1/get_db`；如果宿主机不支持，再回退 `GET /container_api/v1/get_db` 或 `GET /container_api/v1/list_names`
- 实例详情查 `GET /container_api/v1/get_android_detail/{db_id}`
- 启动相关动作后再查 `rom_status`；克隆流程再查 `clone_status`
- 如果当前会话里同时安装了 `vmos-edge-control-api`，而 control 要走 `host_ip` 路由，先用 `get_db` 或 `get_android_detail` 帮它解析目标 `db_id`
- 批量生命周期接口大多使用 `db_ids`
- 创建实例时 `user_name` 必填，`bool_start` 可选
- `gms_start` / `gms_stop` 是主机级操作，`swap/{enable}` 使用 `1` / `0`
- 上传安装包、文件、证书时显式使用 `multipart/form-data`

## 必读参考

- 先看 `references/api-reference.md` 里的索引，再按模块只打开需要的 reference 文件
- 只有在需要精确路径、字段、轮询细节、示例请求时，才读取对应模块 reference
- 优先按需读取相关段落，不要整份展开到上下文里

## 安全边界

- 主机关机、主机重置、SSD 格式化、实例删除、实例重置、一键新机、镜像升级前必须确认
- 没有明确要求时，不要修改 IP、证书、时区、语言、国家、root 权限或 Google 状态
