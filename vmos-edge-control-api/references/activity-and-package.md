# Activity And Package

## 启动与停止应用

### 启动应用

- `POST /activity/start`
- 参数:
  - `package_name`

### 启动应用并授权

- `POST /activity/launch_app`
- 参数:
  - `package_name`
  - `grant_all_permissions`: 可选，默认 `false`
- 适合首次启动且需要自动授予权限的场景

### 启动指定 Activity

- `POST /activity/start_activity`
- 参数:
  - `package_name`
  - `class_name`
  - `action`
  - `data`
  - `extras`

### 停止应用

- `POST /activity/stop`
- 参数:
  - `package_name`

### 查看前台 Activity

- `GET /activity/top_activity`
- 常用于动作后验证当前页面是否切换成功

## 安装与卸载

### 安装应用文件

- `POST /package/install_sync`
- 说明:
  - 支持 `apk`、`apks`、`apkm`、`xapk`

### 通过 URI 安装

- `POST /package/install_uri_sync`
- 参数:
  - `uri`

### 卸载应用

- `POST /package/uninstall`
- 参数:
  - `package_name`
  - `keep_data`: 可选

## 应用列表

### 获取已安装应用

- `GET /package/list`
- 常见查询:
  - `GET /package/list?type=user`
  - `GET /package/list?type=system`

## 常用组合

### 安装并启动应用

1. `/package/install_sync` 或 `/package/install_uri_sync`
2. `/package/list`
3. 首启授权场景优先 `/activity/launch_app`，否则 `/activity/start`
4. 用 `/activity/top_activity`、`/package/list` 或当前可用的观察接口验证
