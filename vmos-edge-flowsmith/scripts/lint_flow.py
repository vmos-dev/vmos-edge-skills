#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
lint_flow.py — YAML Flow 静态校验器(交付闸门)

抓的是"YAML 语法完全合法、但这个引擎运行时不认或静默失效"的那一类问题 ——
它们不会在解析期报错,任务甚至会报成功,但真机上什么都没发生。

用法:
    python3 lint_flow.py flow.yaml [more.yaml ...]
    python3 lint_flow.py -q flow.yaml         # 只报 ERROR
    python3 lint_flow.py --no-style flow.yaml # 跳过拟人化/跨设备类建议
    python3 lint_flow.py --json flow.yaml     # 结构化输出,便于程序读取

退出码:有任何 ERROR = 1,否则 0。
依赖:PyYAML(pip install pyyaml)
"""

import sys
import re
import json
import difflib

try:
    import yaml
except ImportError:
    sys.stderr.write("需要 PyYAML:pip3 install pyyaml\n")
    sys.exit(2)

# ── 引擎认识的命令(与引擎白名单一致) ──────────────────────────────────────

STRING_COMMANDS = {
    'launchApp', 'stopApp', 'killApp', 'clearState', 'eraseText',
    'inputRandomText', 'inputRandomNumber', 'inputRandomEmail',
    'inputRandomPersonName', 'back', 'hideKeyboard', 'hide keyboard',
    'pasteText', 'scroll', 'waitForAnimationToEnd',
}

OBJECT_COMMANDS = {
    'tapOn', 'longPressOn', 'doubleTapOn', 'assertVisible', 'assertNotVisible',
    'assertTrue', 'inputText', 'launchApp', 'swipe', 'openLink', 'pressKey',
    'eraseText', 'takeScreenshot', 'extendedWaitUntil', 'stopApp', 'killApp',
    'clearState', 'runFlow', 'branch', 'setLocation', 'repeat', 'retry',
    'copyTextFrom', 'setClipboard', 'runScript', 'waitForAnimationToEnd',
    'evalScript', 'scrollUntilVisible', 'setAirplaneMode', 'back', 'hideKeyboard',
    'scroll', 'pasteText', 'inputRandomText', 'inputRandomNumber',
    'inputRandomEmail', 'inputRandomPersonName', 'setPermissions',
    'defineVariables', 'shell', 'sleep', 'httpRequest',
}
ALL_COMMANDS = STRING_COMMANDS | OBJECT_COMMANDS

# pressKey 的合法键名(小写,多词带空格)
KEY_NAMES = set("""home back call endcall star pound power camera clear comma period tab space
enter delete backspace grave minus equals backslash semicolon apostrophe slash at plus menu
search escape lock""".split())
KEY_NAMES |= set(str(d) for d in range(10))
KEY_NAMES |= set("abcdefghijklmnopqrstuvwxyz")
KEY_NAMES |= {'dpad up', 'dpad down', 'dpad left', 'dpad right', 'dpad center',
              'volume up', 'volume down', 'left bracket', 'right bracket',
              'page up', 'page down', 'forward delete'}
KEY_NAMES |= set('numpad %d' % d for d in range(10))

CONDITION_FIELDS = {'visible', 'notVisible', 'true'}   # label 不算条件
SELECTOR_CMDS = {'tapOn', 'longPressOn', 'doubleTapOn', 'assertVisible',
                 'assertNotVisible', 'copyTextFrom'}

# 只接受标量的命令 —— 写成对象会被 String() 成 "[object Object]"
# (assertTrue 也属于这类,但它有专门的报错文案,不重复报)
SCALAR_ONLY = {'inputText', 'setClipboard', 'takeScreenshot',
               'pressKey', 'evalScript', 'shell'}

# 硬编码不支持 optional 的命令(写了也不生效)
NO_OPTIONAL = {'assertTrue', 'inputText', 'evalScript', 'shell', 'setClipboard',
               'takeScreenshot', 'pressKey', 'defineVariables', 'branch'}

# 断言类 —— 放在嵌套块里保护不了父流程
ASSERT_CMDS = {'assertVisible', 'assertNotVisible', 'assertTrue'}

# 看着像系统命令的开头 —— shell 其实是 evalScript 的别名,内容会被当脚本执行
SHELLISH = re.compile(r'^\s*(pm|am|adb|input|settings|dumpsys|getprop|svc|monkey|'
                      r'ls|cat|rm|mkdir|echo|sh|curl|wget|ping|chmod|kill)\b')

COORD = re.compile(r'^\s*-?[\d.]+\s*%?\s*,\s*-?[\d.]+\s*%?\s*$')
PERCENT_COORD = re.compile(r'^\s*-?[\d.]+\s*%\s*,\s*-?[\d.]+\s*%\s*$')
HAS_REGEX_META = re.compile(r'[.*+?\[\]()|\\^$]')
HAS_DIGIT_GROUP = re.compile(r'\d')


def is_dynamic(v):
    """含 ${} 的值在解析期是模板、运行时才求值 —— 任何针对字面量取值域的校验
    都必须先放行它,否则会把正确的参数化写法判成错误(而参数化是这套语法的核心主张)。"""
    return isinstance(v, str) and '${' in v


class Report(object):
    def __init__(self):
        self.items = []          # (level, path, code, message)

    def err(self, path, code, msg):
        self.items.append(('ERROR', path, code, msg))

    def warn(self, path, code, msg):
        self.items.append(('WARN', path, code, msg))

    def errors(self):
        return [i for i in self.items if i[0] == 'ERROR']


def normalize(node):
    """PyYAML 把 `true:` 这种键解析成布尔,而引擎侧对象键一律是字符串
    (`when: { true: ... }` 在引擎里就是字符串键)。这里统一成字符串,
    否则条件字段会被误判成"引擎不认识的字段"。"""
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if isinstance(k, bool):
                k = 'true' if k else 'false'
            elif not isinstance(k, str):
                k = str(k)
            out[k] = normalize(v)
        return out
    if isinstance(node, list):
        return [normalize(x) for x in node]
    return node


def split_sections(text):
    """按引擎的规则切:^---$ 行分段,第 1 段 config,其余拼回当命令区。"""
    parts = re.split(r'(?m)^---[ \t]*$', text)
    if len(parts) < 2:
        return None, None
    return parts[0], '\n---\n'.join(parts[1:])


# ── 各类检查 ────────────────────────────────────────────────────────────────

def check_config(cfg, rep):
    if not isinstance(cfg, dict):
        rep.err('config', 'CFG_SHAPE', 'config 段不是对象')
        return
    if not cfg.get('appId') and not cfg.get('url'):
        rep.err('config', 'CFG_APPID',
                'config 缺 appId(或 url)—— 引擎会直接报 missing_app_target')
    for dead in ('onFlowStart', 'onFlowComplete', 'properties'):
        if dead in cfg:
            rep.err('config.%s' % dead, 'CFG_DEAD_KEY',
                    '顶层 %s 引擎从不读取,写在这里完全无效 —— '
                    '要在流程首尾跑的命令直接写进命令区' % dead)
    handlers = cfg.get('exceptionHandlers')
    if isinstance(handlers, list):
        for i, h in enumerate(handlers):
            p = 'config.exceptionHandlers[%d]' % i
            if isinstance(h, dict):
                if not any(k for k in h if k != 'maxTriggerCount'):
                    rep.err(p, 'EH_EMPTY', '异常处理器没有任何选择器字段')
                if 'maxTriggerCount' not in h:
                    rep.warn(p, 'EH_NO_CAP',
                             '没给 maxTriggerCount —— 弹窗反复出现时可能被无限触发,'
                             '建议给个上限(如 3)')
            elif not isinstance(h, str):
                rep.err(p, 'EH_SHAPE', '异常处理器只能是字符串或对象')


def check_condition(cond, path, rep, what='when'):
    if cond is None:
        return
    if not isinstance(cond, dict):
        rep.err(path, 'COND_SHAPE', '%s 必须是对象(如 { visible: "文字" })' % what)
        return
    known = [k for k in cond if k in CONDITION_FIELDS]
    unknown = [k for k in cond if k not in CONDITION_FIELDS and k != 'label']
    if unknown:
        rep.err(path, 'COND_UNKNOWN_FIELD',
                '条件里有引擎不认识的字段 %s —— 会被丢弃;若因此一个合法字段都不剩,'
                '整个条件【恒为真】。合法字段只有 visible / notVisible / true'
                % ', '.join(sorted(unknown)))
    if len(known) > 1:
        rep.err(path, 'COND_MULTI_FIELD',
                '条件写了多个字段 %s —— 引擎是"首个命中即返回"(true > visible > notVisible),'
                '后面的永远不会被检查。一个条件只写一个字段' % ', '.join(known))
    if not known and not unknown:
        rep.err(path, 'COND_EMPTY', '条件是空的 —— 恒为真')
    if 'true' in cond and isinstance(cond['true'], str):
        expr = cond['true']
        if '${' not in expr and not re.search(r'[<>=!&|]', expr):
            rep.warn(path + '.true', 'COND_TRUE_LITERAL',
                     '脚本条件 "%s" 里没有 ${} 也没有比较运算 —— 非空字符串会被判为真,'
                     '恒真。表达式建议写成 "${...}"' % expr)


def check_selector(sel, path, rep, style=True):
    """sel 可能是字符串简写或对象。"""
    if isinstance(sel, str):
        _check_text_value(sel, path, rep, style)
        return
    if not isinstance(sel, dict):
        return
    if 'text' in sel and isinstance(sel['text'], str):
        _check_text_value(sel['text'], path + '.text', rep, style)
    traits = sel.get('traits')
    if isinstance(traits, str) and 'long-clickable' in traits:
        rep.err(path + '.traits', 'TRAIT_BROKEN',
                'trait "long-clickable" 在引擎里永远匹配不上(解析期和匹配期的写法对不上),'
                '换用别的条件')
    pt = sel.get('point')
    if isinstance(pt, str) and style:
        _check_coord(pt, path + '.point', rep)
    if 'chance' in sel and 'when' in sel:
        rep.warn(path, 'CHANCE_IGNORED',
                 'when 和 chance 同时存在 —— when 生效、chance 被忽略')
    ch = sel.get('chance')
    if isinstance(ch, (int, float)) and not (0 <= ch <= 1):
        rep.err(path + '.chance', 'CHANCE_RANGE', 'chance 应在 0~1 之间,当前 %s' % ch)
    if 'when' in sel:
        check_condition(sel['when'], path + '.when', rep)


def _check_text_value(val, path, rep, style):
    if not isinstance(val, str) or '${' in val:
        return
    if COORD.match(val):
        return   # 坐标简写,另有检查

    # text 是正则:语法非法会直接抛 Invalid regular expression
    if HAS_REGEX_META.search(val):
        try:
            re.compile(val)
        except re.error as e:
            rep.err(path, 'TEXT_BAD_REGEX',
                    '"%s" 作为正则非法(%s)—— text 会被当正则编译,运行时直接抛 '
                    'Invalid regular expression。把括号/中括号转义(如 \\\\( \\\\))或改用 id'
                    % (val, e))
            return
        if re.search(r'(?<!\\)[()\[\]]', val) and re.search(r'(?<!\\)[.*+?|]', val):
            rep.warn(path, 'TEXT_MIXED_META',
                     '"%s" 里同时有括号和通配符 —— 括号会被当分组,匹配的是脱掉括号的文字。'
                     '想匹配字面括号要转义 \\\\( \\\\)' % val)

    if not style:
        return
    if HAS_DIGIT_GROUP.search(val) and not HAS_REGEX_META.search(val):
        rep.warn(path, 'TEXT_LOOKS_VOLATILE',
                 '"%s" 含数字又没有正则通配 —— text 是【全匹配正则】,'
                 '带计数/数量的文案一变就找不到。建议用 "%s" 这类写法剥掉可变部分'
                 % (val, re.sub(r'\d[\d.,万kKwW]*', '.*', val)))


def _check_coord(val, path, rep):
    if not isinstance(val, str) or '${' in val:
        return
    if COORD.match(val) and not PERCENT_COORD.match(val):
        rep.warn(path, 'ABS_COORD',
                 '"%s" 是绝对像素坐标,换分辨率就点偏 —— 改成百分比(如 "50%%, 80%%")'
                 '或找稳定文本' % val)


def _check_percent_bounds(val, path, rep):
    if not isinstance(val, str) or '${' in val:
        return
    for num in re.findall(r'(-?[\d.]+)\s*%', val):
        try:
            f = float(num)
        except ValueError:
            continue
        if f < 0 or f > 100:
            rep.err(path, 'PCT_RANGE',
                    '百分比坐标 %s%% 超出 0~100 —— 引擎会抛错,不是裁剪' % num)


def check_command(name, params, path, rep, ctx):
    style = ctx['style']

    # ── 任意命令都能挂 when(branch 除外)——条件写错的代价一样,所以统一查 ──
    if isinstance(params, dict) and 'when' in params and name != 'branch':
        check_condition(params['when'], path + '.when', rep)

    # ── 该带参数却给了 null ──
    if params is None and name not in STRING_COMMANDS:
        rep.err(path, 'PARAMS_MISSING', '%s 必须带参数,这里是空的' % name)
        return

    # ── 空的命令块:写了容器却没有内容 ──
    if isinstance(params, dict) and isinstance(params.get('commands'), list) \
            and not params['commands']:
        rep.warn(path, 'EMPTY_BLOCK', '%s 的 commands 是空的 —— 这个块什么都不会做' % name)

    # ── 只接受标量的命令写成了对象 ──
    if name in SCALAR_ONLY and isinstance(params, dict):
        leftover = [k for k in params if k not in ('when', 'chance')]
        if leftover:
            rep.err(path, 'SCALAR_ONLY_OBJ',
                    '%s 只接受标量,对象会被 String() 成 "[object Object]" 并【真的拿去用】'
                    '(inputText 就会把这七个字原样输进输入框)。改成 %s: "值";'
                    '要加条件就用 branch / runFlow 包一层' % (name, name))

    # ── optional 写了不生效 ──
    if name in NO_OPTIONAL and isinstance(params, dict) and 'optional' in params:
        rep.warn(path, 'OPTIONAL_NOOP',
                 '%s 硬编码不支持 optional,写了不生效 —— 它失败就是失败' % name)

    # ── 嵌套块里的断言保护不了父流程 ──
    if name in ASSERT_CMDS and ctx['in_block']:
        rep.warn(path, 'ASSERT_NESTED',
                 '断言写在 %s 里 —— 嵌套块的失败【不会冒泡】,父流程照常继续、任务还报成功。'
                 '关键成败判断要放到顶层收口' % ctx['in_block'])

    # ── 选择器类 ──
    if name in SELECTOR_CMDS:
        if isinstance(params, str) and COORD.match(params):
            if style:
                _check_coord(params, path, rep)
            _check_percent_bounds(params, path, rep)
        elif isinstance(params, str) and re.match(r'^\d', params) and ',' in params:
            rep.err(path, 'TEXT_AS_COORD',
                    '"%s" 首字符是数字又含逗号 —— 会被当成坐标解析并抛 Invalid point。'
                    '改成对象形态 { text: "..." } 绕开' % params)
        else:
            check_selector(params, path, rep, style)
            if isinstance(params, dict) and isinstance(params.get('point'), str):
                _check_percent_bounds(params['point'], path + '.point', rep)
        if isinstance(params, dict) and params.get('chance') is not None \
                and not params.get('optional'):
            rep.warn(path, 'CHANCE_NO_OPTIONAL',
                     '概率执行的点击没带 optional: true —— 元素这次没出现就会让整条流程失败')

    # ── 静默失效类 ──
    if name == 'runFlow':
        if isinstance(params, str):
            rep.err(path, 'RUNFLOW_FILE',
                    'runFlow 引用文件路径【静默空跑】—— 路径只被存下、从来没有被读取执行,'
                    '任务还会报成功。把子流程内联到 commands: 里')
        elif isinstance(params, dict):
            if 'file' in params:
                rep.err(path + '.file', 'RUNFLOW_FILE',
                        'runFlow.file 【静默空跑】—— 文件从不被读取。改成内联 commands:')
            if 'env' in params:
                rep.err(path + '.env', 'RUNFLOW_ENV',
                        'runFlow.env 的内容会被丢弃,子流程拿不到这些变量 —— '
                        '改用 defineVariables 或外层变量')
            if 'commands' not in params and 'file' not in params:
                rep.err(path, 'RUNFLOW_EMPTY', 'runFlow 既没有 commands 也没有 file')
            check_condition(params.get('when'), path + '.when', rep)

    if name == 'retry':
        rep.warn(path, 'RETRY_INEFFECTIVE',
                 'retry 只捕获"抛出的异常",而普通命令失败在内层被转成了返回值 —— '
                 '实际【一次都不会重试】。要重试改用 repeat + while 轮询,再在顶层断言收口')
    if name == 'retry' and isinstance(params, dict):
        if 'file' in params:
            rep.err(path + '.file', 'RETRY_FILE', 'retry.file 从不被读取,改用内联 commands:')
        mr = params.get('maxRetries')
        try:
            if mr is not None and float(str(mr)) > 3:
                rep.warn(path + '.maxRetries', 'RETRY_CAP',
                         'maxRetries=%s 会被截断到上限 3' % mr)
        except ValueError:
            pass

    if name == 'runScript' and isinstance(params, dict) and 'file' in params \
            and 'script' not in params:
        rep.err(path + '.file', 'RUNSCRIPT_FILE',
                'runScript.file 指向的文件从不被读取 —— 把脚本直接写进 script:')

    if name == 'assertTrue':
        if isinstance(params, dict):
            rep.err(path, 'ASSERTTRUE_OBJ',
                    'assertTrue 只接受裸字符串;对象形态会被转成 "[object Object]" → '
                    '断言【永远通过】。改成 assertTrue: "${...}"')
        elif isinstance(params, str) and '${' not in params \
                and not re.search(r'[<>=!&|]', params):
            rep.warn(path, 'ASSERTTRUE_LITERAL',
                     '"%s" 里既没有 ${} 也没有比较运算 —— 非空字符串一律判为真,'
                     '这条断言【恒过】,拦不住任何问题' % params)

    if name == 'shell':
        body = params if isinstance(params, str) else ''
        if SHELLISH.match(body):
            rep.err(path, 'SHELL_NOT_SHELL',
                    'shell 不执行系统命令 —— 它是 evalScript 的别名,"%s" 会被当脚本执行 → 语法错'
                    % body.strip()[:40])
        else:
            rep.warn(path, 'SHELL_ALIAS',
                     'shell 只是 evalScript 的别名(执行脚本,不是系统命令),建议直接写 evalScript')

    if name == 'takeScreenshot' and params not in (None, {}):
        rep.warn(path, 'SCREENSHOT_PATH',
                 'takeScreenshot 的路径参数不会传给驱动,存哪由驱动决定')

    # ── shape 类 ──
    if name == 'pressKey':
        if params is None:
            rep.err(path, 'KEY_MISSING', 'pressKey 缺参数 —— 要写成 `- pressKey: home`')
        elif isinstance(params, dict):
            pass                      # 已由 SCALAR_ONLY_OBJ 报过,不重复叠加
        elif not is_dynamic(params):   # ${} 运行时才解析成键名,这里放行
            key = str(params).strip().lower()
            if key not in KEY_NAMES and not key.isdigit():
                guess = difflib.get_close_matches(key, KEY_NAMES, n=1, cutoff=0.5)
                hint = (' 是不是想写 "%s"?' % guess[0]) if guess else ''
                rep.err(path, 'KEY_UNKNOWN',
                        '按键名 "%s" 不在引擎的键名表里,运行时会抛错中断任务 —— '
                        '多词键名必须用空格分隔(如 volume up / page down / dpad up),大小写无所谓。%s'
                        % (params, hint))

    if name == 'swipe' and isinstance(params, dict):
        has_se = 'start' in params and 'end' in params
        if not has_se and 'direction' not in params:
            rep.err(path, 'SWIPE_MODE',
                    'swipe 必须命中一种模式:start+end / direction+from / 只有 direction')
        if style:
            for k in ('start', 'end'):
                if isinstance(params.get(k), str):
                    _check_coord(params[k], path + '.' + k, rep)
        d = params.get('direction')
        if isinstance(d, str) and not is_dynamic(d) \
                and d.upper() not in ('UP', 'DOWN', 'LEFT', 'RIGHT'):
            rep.err(path + '.direction', 'SWIPE_DIR',
                    'direction 只能是 UP / DOWN / LEFT / RIGHT,当前 "%s"' % d)
        for k in ('start', 'end'):
            if isinstance(params.get(k), str):
                _check_percent_bounds(params[k], path + '.' + k, rep)
        if style and ctx['in_repeat'] and 'waitToSettleTimeoutMs' not in params:
            rep.warn(path, 'SWIPE_SETTLE',
                     '循环里的滑动没设 waitToSettleTimeoutMs: 0 —— 每滑一次都会等界面"稳定"'
                     '约 1.5 秒,信息流类页面永远不稳定,纯属白等')

    if name == 'scrollUntilVisible' and isinstance(params, dict):
        if 'element' not in params:
            key = 'selector' if 'selector' in params else None
            rep.err(path, 'SUV_ELEMENT',
                    'scrollUntilVisible 缺 element:(要滚到的元素)%s'
                    % ('—— 你写的是 selector:,键名应该是 element:' if key else ''))
        else:
            check_selector(params['element'], path + '.element', rep, style)

    if name == 'sleep':
        if isinstance(params, list):
            if len(params) != 2:
                rep.err(path, 'SLEEP_RANGE', 'sleep 数组形态必须是 [min, max]')
        elif isinstance(params, dict):
            if ('min' in params) != ('max' in params):
                rep.warn(path, 'SLEEP_HALF_RANGE',
                         'sleep 只给了 min 或 max —— 引擎要两个都在才走随机区间,'
                         '否则退回 duration')
        elif isinstance(params, (int, float)) and style:
            rep.warn(path, 'SLEEP_FIXED',
                     'sleep 是固定值 %s —— 每次一模一样是机器特征,建议 [min, max] 随机区间'
                     % params)

    if name == 'repeat' and isinstance(params, dict):
        if not any(k in params for k in ('times', 'duration', 'while')):
            rep.warn(path, 'REPEAT_UNBOUNDED',
                     'repeat 没有 times / duration / while —— 会一直跑到隐式上限'
                     '(1000 次或 30 分钟),收敛不可控')
        check_condition(params.get('while'), path + '.while', rep, what='while')
        t = params.get('times')
        try:
            if t is not None and '${' not in str(t) and float(str(t)) > 1000:
                rep.warn(path + '.times', 'REPEAT_CAP',
                         'times=%s 会被截断到上限 1000' % t)
        except ValueError:
            pass

    if name == 'branch':
        if not isinstance(params, list):
            rep.err(path, 'BRANCH_SHAPE', 'branch 的参数必须是数组(每项一个 arm)')
        else:
            has_else = False
            for i, arm in enumerate(params):
                ap = '%s[%d]' % (path, i)
                if not isinstance(arm, dict):
                    rep.err(ap, 'BRANCH_ARM', 'branch 的每个 arm 必须是对象')
                    continue
                if 'commands' not in arm:
                    rep.err(ap, 'BRANCH_ARM_CMDS', 'branch arm 缺 commands:')
                if 'when' in arm:
                    check_condition(arm['when'], ap + '.when', rep)
                else:
                    has_else = True
            if not has_else:
                rep.warn(path, 'BRANCH_NO_ELSE',
                         'branch 没有 else 分支(没有 when 的 arm)—— 全不命中时整条 branch 被跳过,'
                         '流程可能悄悄少做一步')

    if name == 'httpRequest' and isinstance(params, dict):
        if 'url' not in params:
            rep.err(path, 'HTTP_URL', 'httpRequest 缺 url')
        r = params.get('retry')
        if isinstance(r, dict) and r.get('times') and not params.get('jsonPath'):
            rep.warn(path + '.retry', 'HTTP_RETRY_NOOP',
                     '设了 retry 但没有 jsonPath —— 引擎只在 jsonPath 抽不到值时才重试,'
                     '这里的 retry 不会生效')

    if name == 'defineVariables' and isinstance(params, dict):
        for k, v in params.items():
            vp = '%s.%s' % (path, k)
            if isinstance(v, str) and '${' in v and ctx['in_subflow']:
                rep.err(vp, 'DEFVAR_NO_INTERP',
                        'runFlow / retry 里的 defineVariables 【不做 ${} 插值】,'
                        '"%s" 会被原样当字面量存进去。改用 evalScript: "%s = ..."' % (v, k))
            if isinstance(v, str) and re.match(r'^-?\d+(\.\d+)?$', v.strip()):
                rep.warn(vp, 'DEFVAR_QUOTED_NUM',
                         '"%s" 加了引号 → 变量是【字符串】,${%s + 1} 会变成字符串拼接。'
                         '数字别加引号' % (v, k))


def walk_commands(items, path, rep, ctx):
    if not isinstance(items, list):
        rep.err(path, 'CMDS_SHAPE', '命令区必须是数组')
        return
    prev_sleep_ms = 0
    for i, item in enumerate(items):
        p = '%s[%d]' % (path, i)

        # 长 sleep 紧跟断言:查找超时会被"距上次交互耗时"扣掉
        if ctx['style'] and prev_sleep_ms >= 5000 and isinstance(item, dict):
            nm = list(item.keys())[0] if item else ''
            if nm in ('assertVisible', 'assertNotVisible'):
                rep.warn(p, 'SLEEP_EATS_TIMEOUT',
                         '前一条 sleep 约 %d ms,而元素查找超时会被"距上次交互的耗时"扣掉 —— '
                         '这条断言几乎没有等待窗口。把 sleep 挪到断言之后,或改用 extendedWaitUntil '
                         '显式给 timeout' % prev_sleep_ms)
        prev_sleep_ms = _sleep_ms(item)

        if isinstance(item, str):
            if item not in STRING_COMMANDS:
                _unknown(item, p, rep, bare=True)
            continue
        if not isinstance(item, dict):
            rep.err(p, 'ITEM_SHAPE', '命令项必须是字符串或单键对象')
            continue
        keys = list(item.keys())
        if not keys:
            rep.err(p, 'ITEM_EMPTY', '空的命令项')
            continue
        name = keys[0]
        if len(keys) > 1:
            rep.err(p, 'ITEM_MULTI_KEY',
                    '这一项有 %d 个键 %s —— 引擎【只取第一个键 "%s"】,其余全部静默丢弃。'
                    '多半是缩进写错了:字段要缩进到命令名下面'
                    % (len(keys), keys, name))
        if name not in ALL_COMMANDS:
            _unknown(name, p, rep)
            continue
        params = item[name]
        cp = '%s.%s' % (p, name)
        check_command(name, params, cp, rep, ctx)

        # 递归子命令
        if isinstance(params, dict) and 'commands' in params:
            sub = dict(ctx)
            sub['in_block'] = name
            if name == 'repeat':
                sub['in_repeat'] = True
            if name in ('runFlow', 'retry'):
                sub['in_subflow'] = True
            walk_commands(params['commands'], cp + '.commands', rep, sub)
        if name == 'branch' and isinstance(params, list):
            sub = dict(ctx)
            sub['in_block'] = 'branch'
            for j, arm in enumerate(params):
                if isinstance(arm, dict) and isinstance(arm.get('commands'), list):
                    walk_commands(arm['commands'], '%s[%d].commands' % (cp, j), rep, sub)


# 表达式里天然存在、不需要定义的名字
BUILTINS = {
    'Math', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object', 'Date',
    'parseInt', 'parseFloat', 'isNaN', 'console', 'maestro', 'undefined',
    'null', 'true', 'false', 'NaN', 'Infinity', 'typeof', 'new', 'return',
}
TEMPLATE = re.compile(r'\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}')
IDENT = re.compile(r'(?<![.\w$])([A-Za-z_$][\w$]*)')
# 字符串字面量里的词不是变量名(`${mode === 'dm'}` 里的 dm),取标识符前先剥掉
STRLIT = re.compile(r"'[^']*'|\"[^\"]*\"|`[^`]*`")
ASSIGN = re.compile(r'(?<![=!<>])\b([A-Za-z_$][\w$]*)\s*=(?!=)')


def collect_defined(cfg, items, acc):
    """收集这份 flow 里被定义过的变量名。跨作用域取并集(宁可漏报不误报)。"""
    if isinstance(cfg, dict) and isinstance(cfg.get('env'), dict):
        acc.update(str(k) for k in cfg['env'])
    _scan_defs(items, acc)


def _scan_defs(node, acc):
    if isinstance(node, list):
        for x in node:
            _scan_defs(x, acc)
        return
    if not isinstance(node, dict):
        return
    for k, v in node.items():
        if k == 'defineVariables' and isinstance(v, dict):
            acc.update(str(n) for n in v)
        elif k in ('evalScript', 'shell') and isinstance(v, str):
            acc.update(ASSIGN.findall(v))
        elif k == 'runScript' and isinstance(v, dict):
            if isinstance(v.get('script'), str):
                acc.update(ASSIGN.findall(v['script']))
            if isinstance(v.get('env'), dict):
                acc.update(str(n) for n in v['env'])
        elif k == 'httpRequest' and isinstance(v, dict) and v.get('outputVariable'):
            acc.add(str(v['outputVariable']))
        _scan_defs(v, acc)


ARITH_OUTSIDE = re.compile(r'\$\{[^{}]+\}\s*[-+*/]\s*[\d(]|[\d)]\s*[-+*/]\s*\$\{[^{}]+\}')


def check_arith_outside(node, path, rep):
    """`"${MIN} * 60000"` 这种把运算写在插值外面 —— 插值结果是字符串,
    数值字段再 parseInt 只会取到前半截(`"25 * 60000"` → 25),静默差三个数量级。
    正确写法是把整个表达式放进去:`"${MIN * 60000}"`。"""
    if isinstance(node, list):
        for i, x in enumerate(node):
            check_arith_outside(x, '%s[%d]' % (path, i), rep)
        return
    if isinstance(node, dict):
        for k, v in node.items():
            check_arith_outside(v, '%s.%s' % (path, k), rep)
        return
    if isinstance(node, str) and ARITH_OUTSIDE.search(node):
        rep.err(path, 'ARITH_OUTSIDE_TEMPLATE',
                '"%s" 把运算写在了 ${} 外面 —— 插值结果是字符串,数值字段只会取到前半截'
                '(如 "25 * 60000" → 25),静默差几个数量级。'
                '把整个表达式放进去:"${...运算写在里面...}"' % node)


def check_undefined_refs(node, path, rep, defined):
    """${} 里引用没定义过的变量 —— 求值会抛错并【终止整个任务】,
    optional / 异常处理器都拦不住,所以这是最值得静态抓的一类。"""
    if isinstance(node, list):
        for i, x in enumerate(node):
            check_undefined_refs(x, '%s[%d]' % (path, i), rep, defined)
        return
    if isinstance(node, dict):
        for k, v in node.items():
            check_undefined_refs(v, '%s.%s' % (path, k), rep, defined)
        return
    if not isinstance(node, str):
        return
    for expr in TEMPLATE.findall(node):
        for ident in IDENT.findall(STRLIT.sub("''", expr)):
            if ident in BUILTINS or ident in defined:
                continue
            rep.warn(path, 'UNDEF_VAR',
                     '${...} 里引用了 "%s",但这份 flow 里没有任何地方定义过它 —— '
                     '求值失败会【直接终止整个任务】,optional 和异常处理器都拦不住。'
                     '如果它由调度端 env 注入,也请在顶部 env: 里写一个默认值兜底' % ident)
            return          # 每个字符串只报一次,避免刷屏


def _sleep_ms(item):
    """这一条如果是 sleep,返回它的(最小)毫秒数,否则 0。"""
    if not isinstance(item, dict) or list(item.keys())[:1] != ['sleep']:
        return 0
    v = item['sleep']
    if isinstance(v, (int, float)):
        return int(v)
    if isinstance(v, list) and v and isinstance(v[0], (int, float)):
        return int(v[0])
    if isinstance(v, dict):
        for k in ('min', 'duration'):
            if isinstance(v.get(k), (int, float)):
                return int(v[k])
    return 0


def _unknown(name, path, rep, bare=False):
    guess = difflib.get_close_matches(name, sorted(ALL_COMMANDS), n=1, cutoff=0.6)
    hint = (' 是不是想写 "%s"?' % guess[0]) if guess else ''
    if not hint and name in OBJECT_COMMANDS:
        hint = ' 这个命令需要带参数,不能裸写。'
    if bare and name in ALL_COMMANDS:
        return
    rep.err(path, 'CMD_UNKNOWN',
            '"%s" 不是引擎认识的命令,解析会直接失败。%s' % (name, hint))


def lint_file(fpath, style=True):
    rep = Report()
    try:
        with open(fpath, 'r', encoding='utf-8') as f:
            text = f.read()
    except UnicodeDecodeError:
        rep.err(fpath, 'NOT_TEXT',
                '这个文件不是 UTF-8 文本,读不了 —— 确认它确实是一份 YAML flow')
        return rep

    cfg_text, cmd_text = split_sections(text)
    if cfg_text is None:
        rep.err(fpath, 'NO_SEPARATOR',
                '找不到 --- 分隔线 —— flow 必须是 [config] --- [命令数组] 两段')
        return rep

    try:
        cfg = yaml.safe_load(cfg_text)
    except yaml.YAMLError as e:
        rep.err('config', 'YAML_PARSE', 'config 段 YAML 解析失败:%s' % e)
        return rep
    try:
        cmds = yaml.safe_load(cmd_text)
    except yaml.YAMLError as e:
        rep.err('commands', 'YAML_PARSE', '命令段 YAML 解析失败:%s' % e)
        return rep

    cfg = normalize(cfg)
    cmds = normalize(cmds)
    check_config(cfg or {}, rep)
    walk_commands(cmds or [], 'commands', rep,
                  {'style': style, 'in_repeat': False, 'in_block': None,
                   'in_subflow': False})

    defined = set()
    collect_defined(cfg or {}, cmds or [], defined)
    check_undefined_refs(cmds or [], 'commands', rep, defined)
    check_arith_outside(cmds or [], 'commands', rep)

    # 顶层一条断言都没有 = 任务成败无人判定(嵌套块里的失败不会冒泡)
    if isinstance(cmds, list) and cmds:
        top = set()
        for item in cmds:
            if isinstance(item, str):
                top.add(item)
            elif isinstance(item, dict) and item:
                top.add(list(item.keys())[0])
        if not (top & ASSERT_CMDS):
            rep.warn('commands', 'NO_TOP_ASSERT',
                     '顶层一条断言都没有 —— 嵌套块里的失败不会冒泡,'
                     '这份 flow 出了错也会报"成功"。收口写法见 patterns.md §10')
    return rep


def main(argv):
    quiet = '-q' in argv or '--quiet' in argv
    style = '--no-style' not in argv
    as_json = '--json' in argv
    files = [a for a in argv if not a.startswith('-')]
    if not files:
        sys.stderr.write(__doc__)
        return 2

    total_err = 0
    results = []
    for fpath in files:
        try:
            rep = lint_file(fpath, style=style)
        except OSError as e:
            sys.stderr.write('无法读取 %s: %s\n' % (fpath, e))
            total_err += 1
            continue
        except Exception as e:      # 单个文件出意外不该中断整批 lint
            sys.stderr.write('校验 %s 时出错(请反馈):%s: %s\n'
                             % (fpath, type(e).__name__, e))
            total_err += 1
            continue

        shown = [i for i in rep.items if not (quiet and i[0] == 'WARN')]
        n_err = len(rep.errors())
        total_err += n_err

        if as_json:
            results.append({
                'file': fpath,
                'ok': n_err == 0,
                'errors': n_err,
                'warnings': len(rep.items) - n_err,
                'findings': [{'level': l, 'rule': c, 'path': p, 'message': m}
                             for l, p, c, m in rep.items],
            })
            continue

        print('\n── %s ──' % fpath)
        if not shown:
            print('  ✅ 没有发现问题' if not rep.items else '  ✅ 无 ERROR')
        for level, path, code, msg in shown:
            mark = '❌ ERROR' if level == 'ERROR' else '⚠️  WARN '
            print('  %s [%s] %s\n      %s' % (mark, code, path, msg))
        print('  —— %d ERROR / %d WARN' % (n_err, len(rep.items) - n_err))

    if as_json:
        json.dump({'ok': total_err == 0, 'totalErrors': total_err, 'files': results},
                  sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write('\n')
    elif total_err:
        print('\n交付闸门:有 %d 个 ERROR 必须改掉。' % total_err)
    return 1 if total_err else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
