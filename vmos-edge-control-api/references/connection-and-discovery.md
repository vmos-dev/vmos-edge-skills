# Connection And Discovery

## 支持性判断

- 直接调用 `GET /base/version_info`
- 能成功获取返回，就视为当前环境支持 Control API
- 如果拿不到返回、超时，或直接返回 `5xx`，说明当前环境没有暴露 Control API，或当前连接方式不可用
- 如需 MCP 集成，请直接参考官方文档第 6 节

## 缺省地址规则

- 如果用户已经明确给了 `host_ip` 或 `cloud_ip`，优先使用用户给的值
- 如果用户没有明确给 IP，先检查本地是否存在 `cbs_go` 进程
- 本地存在 `cbs_go` 时，默认 `host_ip=127.0.0.1`
- 本地检查建议使用精确匹配，例如：

```bash
pgrep -x cbs_go >/dev/null 2>&1
```

- 如果没有显式 IP，且本地也没有 `cbs_go`：
  - 优先引导用户提供 `host_ip` 或 `cloud_ip`
  - 如果用户已知自己要走宿主机路由，也可以直接提供 `db_id`

## 连接方式

- 宿主机路由 HTTP:
  - `http://{host_ip}:18182/android_api/v2/{db_id}/{path}`
  - 仅在当前同时安装了 `vmos-edge-container-api` 时使用
  - 使用前必须先通过 `POST /container_api/v1/get_db` 或 `GET /container_api/v1/get_android_detail/{db_id}` 解析目标 `db_id`
- 如果当前只有 `vmos-edge-control-api`，但用户已经提供了 `host_ip` 和 `db_id`，也可以直接走这条路由
- 云机直连 HTTP:
  - `http://{cloud_ip}:18185/api/{path}`
  - 仅在当前只有 `vmos-edge-control-api` 时作为默认优先执行路径
  - 仅支持开启了局域网模式的云机
  - 如果 `GET /base/version_info` 拿不到返回，说明当前云机没有暴露 Control API 或没有开启局域网模式

### 通过 host_ip 先解析 db_id

```bash
HOST_IP="${VMOS_EDGE_HOST_IP}"
/usr/bin/curl -s -X POST "http://${HOST_IP}:18182/container_api/v1/get_db" \
  -H "Content-Type: application/json" \
  -d '{}'
```

拿到目标实例的 `db_id` 之后，再请求：

```bash
BASE_URL="http://${VMOS_EDGE_HOST_IP}:18182/android_api/v2/${VMOS_EDGE_DB_ID}"
curl -s "$BASE_URL/base/version_info"
```

### cloud_ip 快速模板

```bash
BASE_URL="http://${VMOS_EDGE_CLOUD_IP}:18185/api"
curl -s "$BASE_URL/base/version_info"
```

## 命名兼容

- 文档里的接口路径是 `/input/click` 这种格式
- 部分 MCP 客户端会把它规范化为 `input_click`、`base_version_info` 这类工具名
- 以 `supported_list`、`list_action` 或客户端实际暴露的工具名为准

## 通用响应

```json
{
  "code": 200,
  "data": {},
  "msg": "OK",
  "request_id": "..."
}
```

## 基础能力发现

### 获取 API 版本

- `GET /base/version_info`
- 返回 `version_name`、`version_code`、`supported_list`
- 能成功获取返回，就视为当前环境支持 Control API

### 查询接口清单

- `POST /base/list_action`
- 参数:
  - `paths`: 可选，接口路径数组
  - `detail`: 可选，是否返回详情

按需加载建议：

- 先用不带 `detail` 或 `detail=false` 的请求，低成本拿接口名和描述
- 需要某个接口的详细使用方法时，再传 `paths` 并带 `detail=true`
- 可以全量查，也可以只查一组候选接口

建议：

- 第一次连接时先查 `GET /base/version_info`
- 能返回就继续；拿不到返回就不要再按支持状态继续执行
- 再查 `POST /base/list_action`
- 用实际返回判断当前设备属于哪一类能力集合：
  - 截图型：有 `screenshot/format`、`screenshot/raw`、`screenshot/data_url`
  - 紧凑层级型：有 `accessibility/dump_compact`
  - 元信息型：只有 `display/info`、`activity/top_activity`、`package/list` 这类接口

示例：

```json
{
  "detail": false
}
```

```json
{
  "paths": ["/activity/start", "/input/click"],
  "detail": true
}
```

### 暂停响应

- `POST /base/sleep`
- 参数:
  - `duration`: 毫秒

### 多步执行说明

- 多步动作请按普通接口逐步执行并逐步验证
