# Maintenance And Logs

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

## 常用流程

### 一键新机

1. `POST /container_api/v1/replace_devinfo`
2. 传 `db_ids`
3. 轮询实例状态直到完成

## 安全边界

- 主机关机、主机重置、SSD 格式化、实例删除、实例重置、一键新机、镜像升级前必须确认
- 没有明确要求时，不要修改 IP、证书、时区、语言、国家、root 权限或 Google 状态
