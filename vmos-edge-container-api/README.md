# VMOS Edge Container Management Skill

通过 VMOS Edge Container API 管理云手机实例。

## 目录结构

- `SKILL.md`
  - skill 入口，适合 skill 生态读取
- `references/api-reference.md`
  - 容器管理接口速查表
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

## 安装

推荐直接通过 `skills` CLI 安装：

```bash
npx skills add https://github.com/vmos-dev/vmos-edge-skills --skill vmos-edge-container-api
```

如果需要查看 skill 的完整内容和附加参考，可直接打开这个目录下的 `SKILL.md` 与 `references/`。

## 推荐阅读

1. 先看 `SKILL.md`
2. 精确路径、字段、轮询方式看 `references/api-reference.md`
