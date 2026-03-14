# Input Control

## 点击与多击

### 点击

- `POST /input/click`
- 参数:
  - `x`
  - `y`

### 多击

- `POST /input/multi_click`
- 参数:
  - `x`
  - `y`
  - `times`
  - `interval`

## 文本与按键

### 输入文本

- `POST /input/text`
- 参数:
  - `text`

### 按键

- `POST /input/keyevent`
- 参数:
  - `key_code`
  - `key_codes`

## 滑动

### 直线滑动

- `POST /input/swipe`
- 参数:
  - `start_x`
  - `start_y`
  - `end_x`
  - `end_y`
  - `duration`
  - `up_delay`

### 曲线滑动

- `POST /input/scroll_bezier`
- 参数:
  - `start_x`
  - `start_y`
  - `end_x`
  - `end_y`
  - `duration`
  - `up_delay`
  - `clear_fling`

## 使用建议

- 先用截图、`/accessibility/dump_compact` 或 `/accessibility/node` 定位目标区域
- 如果能通过结构化节点完成动作，优先 `/accessibility/node`
- 优先使用专用输入接口，不要默认退回 `/system/shell`
- 每个关键动作后重新观察当前页面
