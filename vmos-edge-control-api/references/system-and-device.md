# System And Device

## Shell

### 执行 shell

- `POST /system/shell`
- 参数:
  - `command`
  - `as_root`: 可选

使用建议：

- 没有专用接口时才考虑 `/system/shell`
- 改系统设置、执行危险命令前先确认用户意图

## Settings

- `POST /system/settings_get`
- `POST /system/settings_put`

使用建议：

- 读取或修改 Android Settings 时，优先这两个专用接口
- 不要为了改 Settings 默认退回 `settings put` 之类 shell 命令

## 剪贴板

- `POST /clipboard/set`
- `GET /clipboard/get`
- `GET /clipboard/list`
- `POST /clipboard/clear`

## Google 服务

- `POST /google/set_enabled`
- `POST /google/reset_gaid`
- `GET /google/get_enabled`

## 默认安全边界

- 删除应用、清数据、系统设置、权限修改、shell 操作前先确认
- 没有明确要求时，不要改时区、语言、国家、Google 状态、设备信息、定位或传感器
