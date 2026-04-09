# VMOS Edge AI Agent Skills

VMOS Edge 官方 skills 仓库，推荐直接通过 `npx skills add` 安装。

## Skills

| Skill                     | 用途                                           | 连接入口                | 协议                         |
| ------------------------- | ---------------------------------------------- | ----------------------- | ---------------------------- |
| `vmos-edge-control-api`   | 控制单台 Android 云机                          | `host_ip` 或 `cloud_ip` | Android Control API          |
| `vmos-edge-container-api` | 管理云手机容器实例                             | `host_ip`               | HTTP Container API（宿主机） |
| `workflow-skill-creator`  | 录制 Android UI 自动化工作流并编译为可重放脚本 | `cloud_ip`              | Android Control API + CLI    |

control skill 的连接入口要看当前是否同时安装了 container skill：

- 只安装 `vmos-edge-control-api` 时，使用云机 IP（`cloud_ip`），并且云机必须开启局域网模式
- 同时安装 `vmos-edge-container-api` 时，`vmos-edge-control-api` 优先使用宿主机 IP（`host_ip`）
- `vmos-edge-container-api` 直接接宿主机 IP（`host_ip`）
- 如果用户没有明确给 IP，且本地存在 `cbs_go` 进程，默认使用 `127.0.0.1`

## 安装

列出仓库里的可用 skills：

```bash
npx skills add https://github.com/vmos-dev/vmos-edge-skills --list
```

安装 control skill：

```bash
npx skills add https://github.com/vmos-dev/vmos-edge-skills --skill vmos-edge-control-api
```

安装 container skill：

```bash
npx skills add https://github.com/vmos-dev/vmos-edge-skills --skill vmos-edge-container-api
```

安装 workflow skill creator：

```bash
npx skills add https://github.com/vmos-dev/vmos-edge-skills --skill workflow-skill-creator
```

`skills` CLI 会把这个仓库分发给 Codex、Cursor、Claude Code、Gemini CLI、GitHub Copilot、OpenClaw 等兼容 agent。

## 结构

每个 skill 目录采用统一结构：

- `SKILL.md`
- `references/`
- 可选包装文件：`prompt.md`、`claude-code.md`、`cursor.mdc`

其中 `SKILL.md + references/` 是主要入口，其余文件只作为兼容不同 agent 的附加材料保留。

## MCP 集成

如果你的 agent 已经支持 MCP，并且希望把 control 能力暴露成结构化工具，请直接参考官方 MCP 文档，不再使用仓库内模板文件：

- [Android Control API - MCP 调用（AI Agent集成）](https://help.vmosedge.com/zh/sdk/agent-api.html#_6-mcp-%E8%B0%83%E7%94%A8-ai-agent-%E9%9B%86%E6%88%90)

## 参考

- [Android Control API 文档](https://help.vmosedge.com/zh/sdk/agent-api.html)
- [Container API 文档](https://help.vmosedge.com/zh/sdk/container-api.html)
- [AI 快速参考使用指南](https://help.vmosedge.com/zh/ai-reference/usage.html)

MIT
