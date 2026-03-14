---
name: vmos-edge-container-api
description: Use this skill when managing VMOS Edge cloud phone containers through the Container API. Covers host queries, instance lifecycle, batch operations, app distribution, async polling, and the Query -> Plan -> Execute -> Verify workflow.
---

# VMOS Edge Container Management

在需要通过 VMOS Edge Container API 管理云手机实例时使用这个 skill。

## 核心流程

- 始终遵循 `Query -> Plan -> Execute -> Verify`
- 先看主机和实例状态，再决定动作
- 批量操作前先筛选出状态正确的实例
- 异步接口完成前不要假设成功

## 数据与字段规则

- Base URL 形态为 `http://{host_ip}:18182`
- 普通请求默认 `application/json`
- 文件上传默认 `multipart/form-data`
- 不要默认使用 `application/yaml`
- shell 里优先使用 `/usr/bin/curl`；如果 `curl` 不在 PATH，不要卡住，直接改用 `/usr/bin/curl` 或 Python
- 主机级接口走 `/v1/*`，例如 `heartbeat`、`systeminfo`、`net_info`
- 实例级接口走 `/container_api/v1/*`
- `get_db` 在部分宿主机上是 `POST /container_api/v1/get_db`，不要写死成 `GET`
- 大多数批量生命周期接口使用 `db_ids`，不要写成 `ids`
- 创建实例时 `user_name` 必填，`bool_start` 可选
- `gms_start` / `gms_stop` 是全局主机级操作
- `swap/{enable}` 使用 `1` / `0`

## 异步接口

- `create`
- `run`
- `stop`
- `reboot`
- `reset`
- `delete`
- `upgrade_image`
- `replace_devinfo`
- `clone`

默认校验：

1. 优先查 `POST /container_api/v1/get_db`
2. 如果当前宿主机不支持，再回退 `GET /container_api/v1/get_db` 或 `GET /container_api/v1/list_names`
3. 查 `get_android_detail`
4. 启动相关动作再查 `rom_status`
5. 克隆流程额外查 `clone_status`

## 默认策略

- 主机可用性先查 `GET /v1/heartbeat`、`GET /v1/systeminfo`
- 查询实例列表时，优先尝试 `POST /container_api/v1/get_db`；如果宿主机不支持，再回退 `GET /container_api/v1/get_db` 或 `GET /container_api/v1/list_names`
- 创建实例前先确认镜像、ADI、网络模式、证书、分辨率是否真的需要
- 请求里已有 `bool_start=true` 时，不要再重复 `run`
- 上传 APK、上传文件、导入证书时显式使用 `multipart/form-data`
- 删除、重置、一键新机、镜像升级前先确认影响范围

## 必读参考

- 需要精确路径、参数名、示例请求时，必须读取 `references/api-reference.md`

## 安全边界

- 主机关机、主机重置、SSD 格式化、实例删除、实例重置、一键新机、镜像升级前必须确认
- 没有明确要求时，不要修改 IP、证书、时区、语言、国家、root 权限或 Google 状态
