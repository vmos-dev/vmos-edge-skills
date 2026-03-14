# Connection And Host

## 基础信息

- Base URL: `http://{host_ip}:18182`
- 普通请求: `application/json`
- 文件上传: `multipart/form-data`
- 不要默认使用 `application/yaml`

## 缺省地址规则

- 如果用户已经明确给了 `host_ip`，优先使用用户给的值
- 如果用户没有明确给 IP，先检查本地是否存在 `cbs_go` 进程
- 本地存在 `cbs_go` 时，默认 `host_ip=127.0.0.1`
- 本地检查建议使用精确匹配，例如：

```bash
pgrep -x cbs_go >/dev/null 2>&1
```

- 如果没有显式 IP，且本地也没有 `cbs_go`，引导用户提供 `host_ip`

## 通用响应

```json
{
  "code": 200,
  "data": {},
  "msg": "OK"
}
```

## 常见状态

- `creating`
- `starting`
- `running`
- `stopping`
- `stopped`
- `rebooting`
- `rebuilding`
- `renewing`
- `deleting`

## 默认按异步处理的接口

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
