# Instances

## 创建实例

- `POST /container_api/v1/create`
- 关键参数:
  - `user_name`: 必填
  - `count`: 可选，默认 `1`
  - `bool_start`: 可选，默认 `false`
  - `bool_macvlan`
  - `macvlan_network`
  - `macvlan_start_ip`
  - `image_repository`
  - `adiID`
  - `resolution`
  - `locale`
  - `timezone`
  - `country`
  - `userProp`
  - `cert_hash`
  - `cert_content`

示例：

```json
{
  "user_name": "test-001",
  "bool_start": false,
  "image_repository": "vcloud_android13_edge_20250925011125",
  "adiID": 1039
}
```

## 实例列表与详情

| Method | Path | 说明 |
| --- | --- | --- |
| POST / GET | `/container_api/v1/get_db` | 获取实例列表，当前宿主机常见为 `POST` |
| GET | `/container_api/v1/list_names` | 查询全部实例 ID / 用户名 / ADB |
| GET | `/container_api/v1/get_android_detail/{db_id}` | 获取单实例详情 |
| GET | `/container_api/v1/adb_start/{db_id}` | 获取 ADB 连接命令 |
| GET | `/container_api/v1/screenshots/{db_id}` | 获取实例截图 |
| GET | `/container_api/v1/sync_status` | 同步实例状态 |

如果当前会话里同时安装了 `vmos-edge-control-api`，而 control 要走 `host_ip` 路由：

- 先用 `get_db` 或 `get_android_detail` 解析目标 `db_id`
- 再交给 control skill 继续走 `http://{host_ip}:18182/android_api/v2/{db_id}`

## 批量生命周期

| Method | Path | 关键字段 |
| --- | --- | --- |
| POST | `/container_api/v1/run` | `db_ids` |
| POST | `/container_api/v1/stop` | `db_ids` |
| POST | `/container_api/v1/reboot` | `db_ids` |
| POST | `/container_api/v1/reset` | `db_ids` |
| POST | `/container_api/v1/delete` | `db_ids` |

示例：

```json
{
  "db_ids": ["EDGE0A1B2C3D4E5", "EDGE6F7G8H9I0J1"]
}
```

## 其他实例接口

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/container_api/v1/upgrade_image` | 升级镜像，使用 `db_ids` |
| GET | `/container_api/v1/rename/{db_id}/{new_user_name}` | 重命名展示名 |
| POST | `/container_api/v1/update_cert` | 更新证书配置 |
| POST | `/container_api/v1/update_user_prop` | 更新用户属性，字段是 `db_ids` 和 `user_prop` |
| POST | `/container_api/v1/set_ip` | 设置 macvlan IP |
| POST | `/container_api/v1/clone` | 克隆实例 |
| GET | `/container_api/v1/clone_status` | 克隆任务状态 |
| GET | `/container_api/v1/rom_status/{db_id}` | 检查 ROM 是否就绪 |
| POST | `/container_api/v1/replace_devinfo` | 一键新机，使用 `db_ids` |
| POST | `/container_api/v1/update_stopped_image` | 批量更新已停止实例镜像 |
| POST | `/container_api/v1/refreshScreenService` | 更新投屏服务，`multipart/form-data` |
| GET | `/container_api/v1/gms_start` | 启动全部实例 GMS |
| GET | `/container_api/v1/gms_stop` | 停用全部实例 GMS |

## 容易写错的字段

- `get_db` 不要写死成 `GET`；不少宿主机要求 `POST`
- 批量接口多数使用 `db_ids`
- 重命名参数是 `new_user_name`
- `replace_devinfo` 里自定义属性是 `userProp`
- `update_user_prop` 里自定义属性字段是 `user_prop`

## 常用流程

### 创建并启动实例

1. `POST /container_api/v1/create`
2. 记录返回的 `db_id`
3. 如果创建时没有 `bool_start=true`，再调用 `POST /container_api/v1/run`
4. 优先轮询 `POST /container_api/v1/get_db`
5. 如果当前宿主机不支持，再回退 `GET /container_api/v1/get_db` 或 `GET /container_api/v1/list_names`
6. 轮询 `GET /container_api/v1/rom_status/{db_id}`，直到 `code=200`
