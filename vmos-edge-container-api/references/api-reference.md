# VMOS Edge Container Reference Index

按需加载时，先看这个索引，再只打开需要的模块文件。

## 先读哪一块

- 连接方式、主机健康、主机级接口：
  - `references/connection-and-host.md`
- 实例列表、创建、生命周期、轮询：
  - `references/instances.md`
- 应用管理、批量分发、文件上传：
  - `references/apps-and-files.md`
- 实例级系统控制：
  - `references/device-control.md`
- 证书、存储、更新、日志：
  - `references/maintenance-and-logs.md`

## 加载建议

- 如果用户没有明确给 IP，先检查本地是否存在 `cbs_go`；存在则默认 `127.0.0.1`
- 默认先查 `GET /v1/heartbeat`、`GET /v1/systeminfo`
- 需要实例列表时，优先 `POST /container_api/v1/get_db`
- 只有在当前任务真的要调用某一类接口时，才打开对应模块文件
- 如果当前会话里同时安装了 `vmos-edge-control-api`，而 control 要走 `host_ip` 路由，优先读取实例模块来解析 `db_id`

## 默认约定

- Base URL 是 `http://{host_ip}:18182`
- 只接 `host_ip`；如果用户给的是 `cloud_ip`，切到 `vmos-edge-control-api`
- 如果没有显式 IP，且本地没有 `cbs_go`，引导用户提供 `host_ip`
- 普通请求默认 `application/json`
- 上传文件、证书、镜像、ADI 时显式使用 `multipart/form-data`
- `get_db` 不要写死成 `GET`；不少宿主机要求 `POST`

## 官方文档

- <https://help.vmosedge.com/zh/sdk/container-api.html>
- <https://help.vmosedge.com/zh/ai-reference/usage.html>
