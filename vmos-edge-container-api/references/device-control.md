# Device Control

## 实例级系统控制

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

## 使用建议

- 没有更专用的控制接口时，才考虑 `shell/{db_id}`
- 时区、国家、语言、GPS、视频注入都属于高影响改动，默认先确认用户意图
- 这类接口是实例级操作，必须传对目标 `db_id`
