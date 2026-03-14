# VMOS Edge Container Management Skill

通过 VMOS Edge Container API 管理云手机实例，输入应为宿主机 IP（`host_ip`）。

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
- `api-reference.md`
  - 兼容入口，指向 `references/api-reference.md`

## Base URL

```text
http://{宿主机IP}:18182
```

如果用户已经明确给了 `host_ip`，优先使用用户给的值。

如果用户没有明确给 IP，且本地存在 `cbs_go` 进程，默认使用：

```text
http://127.0.0.1:18182
```

如果没有显式 IP，且本地没有 `cbs_go`，就需要用户提供 `host_ip`。

如果你手里只有云机 IP（`cloud_ip`），请改用 `vmos-edge-control-api`。

如果当前同时安装了 `vmos-edge-control-api`，它会优先通过这个 skill 使用 `host_ip` 解析实例，再继续做设备控制。

## 安装

推荐直接通过 `skills` CLI 安装：

```bash
npx skills add https://github.com/vmos-dev/vmos-edge-skills --skill vmos-edge-container-api
```

如果需要查看 skill 的完整内容和附加参考，可直接打开这个目录下的 `SKILL.md` 与 `references/`。

## 推荐阅读

1. 先看 `SKILL.md`
2. 先看 `references/api-reference.md` 索引
3. 再按模块看对应 `references/*.md`
