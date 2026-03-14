# VMOS Edge Android Control Skill

通过 VMOS Edge Android Control API 直接控制单台 Android 云机，输入应为云机 IP（`cloud_ip`）。

## 目录结构

- `SKILL.md`
  - skill 入口，适合 skill 生态读取
- `references/api-reference.md`
  - 精确接口路径、参数和速查表
- `prompt.md`
  - 通用纯文本提示词
- `claude-code.md`
  - Claude Code 包装文件
- `cursor.mdc`
  - Cursor 规则文件

## 版本要求

- Android 10: `vcloud_android10_edge_20260110` 及以上
- Android 13: `vcloud_android13_edge_20260110` 及以上
- Android 15: `vcloud_android15_edge_20260110` 及以上
- CBS: `1.1.1.10` 及以上
- HTTP 直连不依赖 MCP
- 如需 MCP 集成，请参考官方文档；MCP 需要 API `1.0.7+`

## 默认连接方式

| 场景 | 地址 |
| --- | --- |
| 云机内 HTTP | `http://{云机IP}:18185/api` |

如果你手里只有宿主机 IP（`host_ip`），请先使用 `vmos-edge-container-api`。

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
2. 精确接口细节看 `references/api-reference.md`
