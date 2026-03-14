# VMOS Edge Android Control Skill

通过 VMOS Edge Android Control API 控制单台 Android 云机。连接入口取决于当前是否同时安装了 `vmos-edge-container-api`。

## 目录结构

- `SKILL.md`
  - skill 入口，适合 skill 生态读取
- `references/api-reference.md`
  - reference 索引，按模块导航
- `references/*.md`
  - 分模块的接口速查表
- `prompt.md`
  - 通用纯文本提示词
- `claude-code.md`
  - Claude Code 包装文件
- `cursor.mdc`
  - Cursor 规则文件

## 支持性判断

- 直接调用 `GET /base/version_info`
- 能成功获取返回，就视为当前环境支持 Control API
- HTTP 直连不依赖 MCP
- 如需 MCP 集成，请直接参考官方文档

## 默认连接方式

| 场景 | 地址 |
| --- | --- |
| 同时安装 `vmos-edge-container-api` | `http://{宿主机IP}:18182/android_api/v2/{云机ID}` |
| 仅安装 `vmos-edge-control-api` | `http://{云机IP}:18185/api` |

说明：

- 如果用户已经明确给了 `host_ip` 或 `cloud_ip`，优先使用用户给的值
- 如果用户没有明确给 IP，且本地存在 `cbs_go` 进程，默认使用 `127.0.0.1`
- 只安装 `vmos-edge-control-api` 时，默认优先使用 `cloud_ip`
- `cloud_ip` 方式仅支持开启了局域网模式的云机
- 如果当前同时安装了 `vmos-edge-container-api`，优先使用 `host_ip`
- 走 `host_ip` 时，必须先通过 `vmos-edge-container-api` 获取目标云机的 `db_id`
- 如果当前只有 `vmos-edge-control-api`，但用户已经给了 `host_ip + db_id`，也可以直接走宿主机路由
- 如果没有显式 IP，且本地没有 `cbs_go`，就需要用户提供 `host_ip`、`cloud_ip`，或在已知宿主机场景下提供 `db_id`
- 如果 `GET /base/version_info` 拿不到返回，说明当前环境没有暴露 Control API，或当前连接方式不可用

## 安装

推荐直接通过 `skills` CLI 安装：

```bash
npx skills add https://github.com/vmos-dev/vmos-edge-skills --skill vmos-edge-control-api
```

如果需要查看 skill 的完整内容和附加参考，可直接打开这个目录下的 `SKILL.md` 与 `references/`。

## MCP 集成

如果你的 agent 已经支持 MCP，并且想把 control 能力暴露成工具，请直接参考官方文档：

- [Android Control API - MCP 调用（AI Agent集成）](https://help.vmosedge.com/zh/sdk/agent-api.html#_6-mcp-%E8%B0%83%E7%94%A8-ai-agent-%E9%9B%86%E6%88%90)

## 推荐阅读

1. 先看 `SKILL.md`
2. 先看 `references/api-reference.md` 索引
3. 再按模块看对应 `references/*.md`
