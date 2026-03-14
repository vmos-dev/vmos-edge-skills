# Observation

## 屏幕与页面观察

### 获取屏幕信息

- `GET /display/info`

### 截图接口

- 常见截图接口：
  - `GET /screenshot/format`
  - `GET /screenshot/raw`
  - `GET /screenshot/data_url`

注意：

- 不是所有设备都会暴露完整截图族接口
- 即使 `version_name` 较新，也要以 `supported_list` / `list_action` 为准
- 某些旧文档里会写成其他截图路径，实际调用时以当前设备返回为准
- 要把截图发给用户时，优先 `screenshot/format` 或 `screenshot/raw`；只有 `data_url` 可用时，再解码成文件
- 适合这些场景：
  - 需要判断视觉布局、卡片位置、图标、颜色、开关状态、遮挡关系
  - 需要做坐标点击、滑动起止点、拖拽路径规划
  - 需要验证页面是否真的渲染出来，而不只是节点树里“存在”

### OpenClaw 图片返回

- OpenClaw 下不要把 `data:image/...;base64,...`、原始 base64、`Read image file [image/jpeg]` 这类文本直接当成最终发图结果
- 正确做法是：
  - 先把截图写到当前工作目录中的图片文件
  - 优先使用相对路径，例如 `./artifacts/vmos-edge-screen-001.jpg`
  - 回复一行简短说明，再单独输出一行 `MEDIA:./artifacts/vmos-edge-screen-001.jpg`
- 不要使用 `MEDIA:/absolute/path.jpg` 或 `MEDIA:~/path.jpg`
- 如果当前客户端支持结构化消息工具并且能直接附带图片，优先用工具的 `media/path/filePath`；`MEDIA:` 作为文本回退

示例：

```text
这是当前页面截图。
MEDIA:./artifacts/vmos-edge-screen-001.jpg
```

### 导出紧凑层级

- `GET /accessibility/dump_compact`
- 适合没有截图接口时快速观察当前界面
- 适合这些场景：
  - 只需要文本、层级、bounds、clickable 等结构化信息
  - 需要低成本快速判断当前页是否到达目标页面
  - 需要进一步衔接 `/accessibility/node` 做结构化查找或动作

### 结构化节点查询

- `POST /accessibility/node`
- 不传 `action` 时可直接返回匹配节点
- 适合按文本、资源 ID、类名、内容描述等条件做结构化定位
- 需要字段和示例时，读取 `references/ui-node.md`

## 观察决策

- 优先截图：
  - 页面包含图标、图片、颜色状态、浮层、复杂布局，结构化文本不够判断
  - 下一步动作依赖具体坐标或视觉相对位置
- 优先 `dump_compact`：
  - 页面以文本、表单、列表、设置项为主
  - 只需要确认文案、bounds、clickable、层级关系
  - 目标是继续走 `/accessibility/node`
- 两者一起用：
  - 先截图理解页面，再用 `dump_compact` / `node` 精确定位
  - 动作后如果只是验证文案或控件是否出现，先用 `dump_compact`
  - 动作后如果要验证视觉状态是否变化，回到截图

## 替换建议

- 旧版无障碍导出 / 查找接口不再写进默认流程
- 优先替换为 `/accessibility/node` 与 `/accessibility/dump_compact`

## 常用组合

### 进入页面并完成点击

1. `/base/version_info`
2. `/base/list_action`
3. 如果支持截图接口，优先走 `/screenshot/format` 或 `/screenshot/raw`；只有必要时再用 `/screenshot/data_url`
4. 再用 `/accessibility/dump_compact` 或 `/accessibility/node`
5. 优先用 `/accessibility/node` 做结构化节点定位 / 操作
6. 要回图给用户时，先把截图落成相对路径文件，再按 OpenClaw 规则输出 `MEDIA:./relative/path`
7. 结构化节点不够用时，再结合截图或 `dump_compact` 里的文本与 `bounds`，规划 `/input/click`、`/input/swipe`、`/input/text`
8. 用当前设备支持的观察接口再次验证
