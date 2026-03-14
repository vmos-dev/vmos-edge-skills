# UI Node

`/accessibility/node` 是当前更适合 AI 使用的结构化 UI 节点接口，可替代旧版节点查找 / 执行流程。

## 默认用法

- 需要按文本、资源 ID、类名、内容描述等条件定位控件时，优先使用 `/accessibility/node`
- 需要“找到就点击 / 输入 / 滚动”时，优先使用 `/accessibility/node + action`
- 只有结构化节点定位不够用时，再回退坐标点击或滑动

## 接口

- `POST /accessibility/node`

参数：

- `selector`: 必填，对象
- `wait_timeout`: 可选，毫秒，默认 `0`
- `wait_interval`: 可选，毫秒，默认 `500`
- `action`: 可选
- `action_params`: 可选，对象

## selector 常用字段

- `xpath`
- `text`
- `content_desc`
- `resource_id`
- `class_name`
- `package`
- `clickable`
- `enabled`
- `scrollable`
- `index`

## action 常用值

- `click`
- `long_click`
- `set_text`
- `clear_text`
- `scroll_forward`
- `scroll_backward`
- `scroll_up`
- `scroll_down`
- `focus`
- `copy`
- `paste`
- `cut`

## 示例

查找节点：

```json
{
  "selector": {
    "text": "设置",
    "clickable": true
  }
}
```

等待并点击：

```json
{
  "selector": {
    "resource_id": "com.example:id/button"
  },
  "wait_timeout": 5000,
  "action": "click"
}
```

设置文本：

```json
{
  "selector": {
    "class_name": "android.widget.EditText"
  },
  "action": "set_text",
  "action_params": {
    "text": "输入内容"
  }
}
```
