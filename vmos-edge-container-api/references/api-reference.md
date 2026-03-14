# VMOS Edge Container API Reference

基于官方 Container API 文档与 AI 快速参考整理，重点保留 agent 最常用、最容易写错的接口与字段。

## 基础信息

- Base URL: `http://{host_ip}:18182`
- 普通请求: `application/json`
- 文件上传: `multipart/form-data`
- 不要默认使用 `application/yaml`

### 通用响应

```json
{
  "code": 200,
  "data": {},
  "msg": "OK"
}
```

### 常见状态

- `creating`
- `starting`
- `running`
- `stopping`
- `stopped`
- `rebooting`
- `rebuilding`
- `renewing`
- `deleting`

### 默认按异步处理的接口

- `create`
- `run`
- `stop`
- `reboot`
- `reset`
- `delete`
- `upgrade_image`
- `replace_devinfo`
- `clone`

推荐校验：

1. 优先查 `POST /container_api/v1/get_db`
2. 如果当前宿主机不支持，再回退 `GET /container_api/v1/get_db` 或 `GET /container_api/v1/list_names`
3. 查 `get_android_detail`
4. 启动后查 `rom_status`
5. 克隆后查 `clone_status`

## 主机管理

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/v1/get_hardware_cfg` | 获取主机配置 |
| GET | `/v1/systeminfo` | 获取 CPU / 内存 / 磁盘 / swap |
| GET | `/v1/net_info` | 获取主机网络信息 |
| GET | `/v1/heartbeat` | 检查主机、Docker、Ping 状态 |
| GET | `/v1/get_img_list` | 获取镜像列表 |
| GET | `/v1/prune_images` | 清理未使用镜像 |
| POST | `/v1/import_image` | 导入镜像，`multipart/form-data` |
| GET | `/v1/swap/{enable}` | `1=开启`，`0=关闭` |
| GET | `/v1/reboot_for_arm` | 重启主机 |
| GET | `/v1/shutdown` | 关闭主机 |
| GET | `/v1/reset` | 重置主机 |
| POST | `/v1/import_adi` | 导入 ADI 模板，`multipart/form-data` |
| GET | `/v1/get_adi_list` | 获取 ADI 列表 |

主机级接口与实例级接口不要混用：

- 主机级健康查询走 `/v1/*`
- 实例生命周期、实例详情走 `/container_api/v1/*`

## 实例管理

### 创建实例

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

### 批量生命周期

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

### 其他实例接口

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/container_api/v1/upgrade_image` | 升级镜像，使用 `db_ids` |
| GET | `/container_api/v1/rename/{db_id}/{new_user_name}` | 重命名展示名 |
| POST | `/container_api/v1/update_cert` | 更新证书配置 |
| POST | `/container_api/v1/update_user_prop` | 更新用户属性，字段是 `db_ids` 和 `user_prop` |
| POST | `/container_api/v1/set_ip` | 设置 macvlan IP |
| GET | `/container_api/v1/get_android_detail/{db_id}` | 获取单实例详情 |
| POST / GET | `/container_api/v1/get_db` | 获取实例列表，当前宿主机常见为 `POST` |
| GET | `/container_api/v1/adb_start/{db_id}` | 获取 ADB 连接命令 |
| GET | `/container_api/v1/screenshots/{db_id}` | 获取实例截图 |
| POST | `/container_api/v1/clone` | 克隆实例 |
| GET | `/container_api/v1/clone_status` | 克隆任务状态 |
| GET | `/container_api/v1/rom_status/{db_id}` | 检查 ROM 是否就绪 |
| GET | `/container_api/v1/list_names` | 查询全部实例 ID / 用户名 / ADB |
| GET | `/container_api/v1/sync_status` | 同步实例状态 |
| POST | `/container_api/v1/replace_devinfo` | 一键新机，使用 `db_ids` |
| POST | `/container_api/v1/update_stopped_image` | 批量更新已停止实例镜像 |
| POST | `/container_api/v1/refreshScreenService` | 更新投屏服务，`multipart/form-data` |
| GET | `/container_api/v1/gms_start` | 启动全部实例 GMS |
| GET | `/container_api/v1/gms_stop` | 停用全部实例 GMS |

### 容易写错的字段

- `get_db` 不要写死成 `GET`；不少宿主机要求 `POST`
- 批量接口多数使用 `db_ids`
- 重命名参数是 `new_user_name`
- `replace_devinfo` 里自定义属性是 `userProp`
- `update_user_prop` 里自定义属性字段是 `user_prop`

## 应用管理

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/android_api/v1/app_get/{db_id}` | 获取已安装应用 |
| POST | `/android_api/v1/app_start` | 批量启动应用，字段 `db_ids` + `app` |
| POST | `/android_api/v1/app_stop` | 批量停止应用，字段 `db_ids` + `app` |
| POST | `/android_api/v1/root_app` | root 权限设置 |
| POST | `/android_api/v1/add_show_other_app_over_permission` | 悬浮窗权限 |

示例：

```json
{
  "db_ids": ["EDGE0A1B2C3D4E5", "EDGE6F7G8H9J0K1"],
  "app": "com.tencent.mm"
}
```

## 文件与分发

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/android_api/v1/upload_file_android_batch` | 批量安装 APK，`multipart/form-data` |
| POST | `/android_api/v1/upload_file_android_upload` | 批量上传文件，`multipart/form-data` |
| POST | `/android_api/v1/install_apk_from_url_batch` | 从 URL 批量安装 APK |
| POST | `/android_api/v1/upload_file_from_url_batch` | 从 URL 批量上传文件 |
| POST | `/android_api/v1/export_phone_apk` | 导出设备 APK |

注意：

- 这些接口里的 `db_ids` 很多是逗号分隔字符串，不是数组
- 上传接口必须显式使用 `multipart/form-data`

示例：

```json
{
  "url": "https://example.com/app.apk",
  "db_ids": "EDGE0A1B2C3D4E5,EDGE6F7G8H9J0K1"
}
```

## 系统控制

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/android_api/v1/shell/{db_id}` | 执行 ADB 命令 |
| GET | `/android_api/v1/stop_front_app/{db_id}` | 停止前台应用 |
| POST | `/android_api/v1/gps_inject/{db_id}` | 注入 GPS |
| POST | `/android_api/v1/video_inject/{db_id}` | 打开视频注入 |
| GET | `/android_api/v1/video_inject_off/{db_id}` | 关闭视频注入 |
| POST | `/android_api/v1/timezone_set/{db_id}` | 设置时区 |
| POST | `/android_api/v1/country_set/{db_id}` | 设置国家 |
| POST | `/android_api/v1/language_set/{db_id}` | 设置语言 |
| GET | `/android_api/v1/get_timezone_locale/{db_id}` | 查询时区 / 国家 / 语言 |
| GET | `/android_api/v1/ip_geo/{db_id}` | 查询经纬度 |

## 证书、存储、更新、日志

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/certificate_manage/file_import_cert` | 文件导入证书，`multipart/form-data` |
| POST | `/certificate_manage/content_import_cert` | 文本导入证书 |
| GET | `/storage/status` | 存储状态 |
| POST | `/storage/format` | SSD 格式化 |
| POST | `/storage/import` | 导入 SSD 数据盘 |
| POST | `/v1/update_cbs` | 更新 CBS，`multipart/form-data` |
| POST | `/v1/update_kernel` | 更新内核，`multipart/form-data` |
| GET | `/interface_logs/recent` | 最近接口日志 |
| GET | `/interface_logs/detail` | 日志详情 |
| GET | `/interface_logs/stats` | 接口成功率统计 |

## Agent 常用流程

### 创建并启动实例

1. `POST /container_api/v1/create`
2. 记录返回的 `db_id`
3. 如果创建时没有 `bool_start=true`，再调用 `POST /container_api/v1/run`
4. 优先轮询 `POST /container_api/v1/get_db`
5. 如果当前宿主机不支持，再回退 `GET /container_api/v1/get_db` 或 `GET /container_api/v1/list_names`
6. 轮询 `GET /container_api/v1/rom_status/{db_id}`，直到 `code=200`

### 批量分发 APK

1. `POST /android_api/v1/upload_file_android_batch`
2. 使用 `multipart/form-data`
3. `db_ids=EDGE1,EDGE2`

### 一键新机

1. `POST /container_api/v1/replace_devinfo`
2. 传 `db_ids`
3. 轮询实例状态直到完成

## 更多接口

完整官方文档：

- <https://help.vmosedge.com/zh/sdk/container-api.html>
- <https://help.vmosedge.com/zh/ai-reference/usage.html>
