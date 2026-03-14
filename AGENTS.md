# vmos-edge-skills

## 项目概述
- VMOS Edge AI Agent 官方技能包，支持所有主流 AI 编程工具
- 两个独立技能：Android 设备控制（HTTP 默认）+ 容器管理（HTTP API）
- 纯文档/配置项目，无编译依赖

## 项目结构
- `vmos-edge-control-api/` - Android 设备控制技能（HTTP 默认）
  - `SKILL.md` - skill 入口
  - `references/api-reference.md` - 官方接口速查表
  - `prompt.md` - 核心提示词
  - 各平台文件（claude-code.md, cursor.mdc 等）
- `vmos-edge-container-api/` - 容器管理技能（HTTP REST API）
  - `SKILL.md` - skill 入口
  - `references/api-reference.md` - 完整 API 速查表
  - `prompt.md` - 核心提示词
  - 各平台文件

## 架构设计
- 每个技能以 `SKILL.md + references/` 为标准 skill 结构
- `prompt.md` 和平台包装文件保留在仓库中，供 skills-compatible agent 作为附加上下文读取
- 各平台文件从核心提示词派生，只是格式/头部适配
- 如需 MCP 集成，统一参考官方文档；本项目不提供 MCP 配置模板
- 容器管理 API 无 MCP 支持，通过 curl/HTTP 调用

## 开发指南
- 修改技能行为：先更新 `SKILL.md` 与 `references/`，再同步 `prompt.md` 和各平台文件
- 新增平台支持：在技能目录下添加对应平台文件
- 所有提示词保持核心工作流一致（Observe→Plan→Act→Verify / Query→Plan→Execute→Verify）

## 当前联调参数

- 当前可用的 Container Host IP: `192.168.180.23`
- 当前可用的 Control db_id: `EDGE1PN1UMLCR024`
- 当前可用的 Control Cloud IP: `192.168.180.200`
- 在这个仓库里测试 `vmos-edge-control-api` 时，优先使用上面这组参数，除非用户明确指定其他设备
