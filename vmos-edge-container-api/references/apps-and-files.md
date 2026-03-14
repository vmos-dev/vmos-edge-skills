# Apps And Files

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

## 常用流程

### 批量分发 APK

1. `POST /android_api/v1/upload_file_android_batch`
2. 使用 `multipart/form-data`
3. `db_ids=EDGE1,EDGE2`
