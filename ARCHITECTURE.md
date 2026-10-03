# OpenOCD MCP 服务器 — 架构与设计文档


> **版本:** 1.0.0 | **作者:** 碧云天书 驱使 Claude Code + Deepseek pro v4 | **日期:** 2026-06-21

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    Claude Code (AI)                      │
│                      MCP 协议 (stdio)                    │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                    server.ts                             │
│  · McpServer + StdioServerTransport                     │
│  · 注册 19 个工具 (config 3 + flash 4 + debug 7         │
│    + monitor 4 + raw 1)                                 │
│  · 全局异常捕获 + SIGINT 防重入                         │
│  · handler 包装: 异常 → { isError: true }               │
└──────┬──────────────────────────────────────────────────┘
       │ 依赖
┌──────▼──────────────────────────────────────────────────┐
│             src/tools/*.ts  (5 个文件)                   │
│  · 每个文件 export create*Tools(client): Tool[]         │
│  · Tool 接口统一 from ./types.js                        │
│  · handler 签名: (params: TypedParams) => Promise<...>  │
│  · 参数校验: zod schema (inputSchema 字段)              │
└──────┬──────────────────────────────────────────────────┘
       │ 共用 client + parse* 函数
┌──────▼──────────────────────────────────────────────────┐
│                openocd-client.ts                        │
│  OpenOCDClient 类:                                       │
│  · spawn 子进程 → 等 telnet 就绪 → TCP 连接 → 命令交互 │
│  · 生命周期: start → sendCommand/batchCommands → stop  │
│  · 状态机: idle → starting → running → error           │
│  · Telnet IAC 协商字节剥离                              │
│  · 基于提示符 \r> 的命令响应提取                        │
└──────┬──────────────────────────────────────────────────┘
       │ 使用
┌──────▼──────────┐    ┌──────────────────┐
│  tcl-parser.ts   │    │  OpenOCD 子进程   │
│  · parseRegisters│    │  (stdio + TCP)   │
│  · parseMemory   │    │                  │
│  · parseFlashBanks│   │  端口: 4444(tel) │
└─────────────────┘    └──────────────────┘
```

### 文件清单

| 文件 | 职责 | 行数 |
|------|------|------|
| src/server.ts | MCP 入口，19 个工具注册，全局异常处理 | ~90 |
| src/openocd-client.ts | OpenOCD 子进程管理，TCP telnet 通信 | ~225 |
| src/tcl-parser.ts | Tcl 响应解析（寄存器/内存/FlashBank） | ~80 |
| src/tools/types.ts | 共享 Tool 接口定义 | ~8 |
| src/tools/config.ts | 连接管理：start/stop/status | ~65 |
| src/tools/flash.ts | 烧录工具：write/erase/read/info | ~100 |
| src/tools/debug.ts | 调试工具：halt/resume/step/reset/bp | ~85 |
| src/tools/monitor.ts | 监控工具：registers/memory/chip | ~70 |
| src/tools/raw.ts | 透传：openocd_command | ~20 |

---

## 2. 通信协议

### 2.1 启动流程（三个阶段）

```
阶段 1: spawn 子进程
  spawn("openocd", ["-s", scriptsDir, "-f", "interface/stlink.cfg",
                    "-f", "target/stm32g4x.cfg", "-c", "init"])
  stdio: ['pipe', 'pipe', 'pipe']
  
阶段 2: 等待 telnet 就绪（累积缓冲区）
  监听 stderr/stdout，检测字符串:
    "Listening on port 4444 for telnet connections"
  最多等待 10 秒，超时则 reject
  错误检测: 输出含 "Error:" 且不含 "Warn"
  
阶段 3: TCP 连接 telnet
  new Socket() → connect(4444, '127.0.0.1')
  连接超时 5 秒
  成功后 state = 'running'
  失败则 taskkill 清理子进程，state = 'idle'，重新 throw
```

**关键设计决策**: 为什么不用 stdin/stdout 管道直接发送 Tcl 命令?

stdin 管道方式在 Windows 上有三个无法解决的问题:
1. OpenOCD 的 Tcl 提示符 `\r> ` 在 Windows CRLF 环境下与 Node.js Buffer 交互不稳定
2. 输出数据跨块分割时提示符检测不可靠
3. stdin 管道关闭时 OpenOCD 会立即退出

TCP telnet 是 OpenOCD 官方支持的交互方式，协议语义明确。

### 2.2 命令执行流程

```
sendCommand(cmd, timeoutMs=10000):
  1. 状态检查: socket && state === 'running'
  2. 缓冲区清理: 移除上次命令的旧提示符 \r> 或 \n>
  3. 写入 socket: cmd + "\r\n"
  4. 等待 handleOutput 检测到提示符
  5. 提取提示符之前的全部文本作为响应
  6. 超时 10s 则 reject
```

### 2.3 提示符检测（核心算法）

```typescript
private handleOutput(data: string): void {
    // Step 1: 剥离 Telnet IAC 协商序列
    // IAC 序列格式: 0xFF + 命令字节(0xFB-0xFE) + 选项字节
    const cleaned = data.replace(/\xff[\xfb-\xfe]./g, '');
    this.buffer += cleaned;

    // Step 2: 检测提示符
    // 真实硬件使用 \r>  (0x0D 0x3E 0x20)
    // 测试 mock 使用 \n>  (0x0A 0x3E 0x20)
    let promptIndex = this.buffer.lastIndexOf('\r> ');
    if (promptIndex === -1) promptIndex = this.buffer.lastIndexOf('\n> ');

    // Step 3: 如果有待处理的命令回调，提取响应
    if (promptIndex !== -1 && this.pendingResolve) {
        const result = this.buffer.substring(0, promptIndex).trim();
        this.buffer = this.buffer.substring(promptIndex + 3); // 跳过 "\r> "
        this.pendingResolve(result);
        this.clearPending();
    }
}
```

**真实 Windows OpenOCD telnet 输出示例**:
```
BANNER:  \xff\xfb\x03\xff\xfb\x01\xff\xfd\x03\xff\xfe\x01Open On-Chip Debugger\r\n\r> 
RESP:    targets\r\n\x00    TargetName    ...\r\n 0* stm32g4x.cpu  ...\r\n\r> 
```

IAC 协商字节: `\xff\xfb`=WILL, `\xff\xfd`=DO, `\xff\xfe`=DON'T, 后跟选项码和参数。

### 2.4 状态机

```
     ┌──────────┐
     │   idle   │ ←──── stop() 清理完毕
     └────┬─────┘
          │ start() 被调用
     ┌────▼────────┐
     │  starting   │ ← OpenOCD 正在初始化
     └────┬────────┘
          │ telnet 连接成功
     ┌────▼────────┐
     │  running    │ ← 可以发送命令
     └────┬────────┘
          │ 子进程意外退出
     ┌────▼────────┐
     │   error     │ ← stop() 或 start() 可恢复
     └─────────────┘

状态切换规则:
- idle → starting: start() 且 state !== running/starting
- starting → running: checkReady 匹配或 connectTelnet 成功
- starting → idle: connectTelnet 失败后清理
- running → error: 子进程 exit 事件且 state 为 running
- any → idle: stop() 总是重置到 idle
```

---

## 3. 缓冲区管理

### 3.1 两个缓冲区

| 缓冲区 | 用途 | 消费方 |
|--------|------|--------|
| `this.buffer` (handleOutput) | 累积所有 telnet 输出 | sendCommand 结果提取 |
| `readyBuf` (checkReady) | 累积启动日志 | 启动就绪检测 |

### 3.2 缓冲区清理时机

```
sendCommand 开始前:
  查找最后一个 \r> 或 \n> 
  截断: buffer = buffer.substring(promptIndex + 3)

handleOutput 检测到提示符时:
  提取: result = buffer.substring(0, promptIndex).trim()
  截断: buffer = buffer.substring(promptIndex + 3)
```

两个地方的截断长度必须一致(3)，否则提示符残留会导致下次响应污染。

---

## 4. Tool 接口规范

### 4.1 共享类型 (src/tools/types.ts)

```typescript
import { z } from 'zod';

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  handler: (params: any) => Promise<Record<string, unknown>>;
}
```

**为什么 handler 参数用 any?**
每个工具的 handler 参数类型不同(`{address: string}` vs `{file: string, verify?: boolean}`)，如果用 `unknown` 会导致 TypeScript 严格模式下无法赋值。`any` 是内部接口的务实选择——实际 handler 实现中参数均有完整内联类型。

### 4.2 工具注册模式

每个 `tools/*.ts` 文件遵循完全相同的模式:

```typescript
import { z } from 'zod';
import type { OpenOCDClient } from '../openocd-client.js';
import type { Tool } from './types.js';

export function createXxxTools(client: OpenOCDClient): Tool[] {
  return [
    {
      name: 'tool_name',
      description: '中文描述',
      inputSchema: {
        param1: z.string().describe('参数说明'),
        param2: z.number().optional().describe('可选参数'),
      },
      handler: async (params: { param1: string; param2?: number }) => {
        // 业务逻辑
        return { success: true, data };
      },
    },
    // ... 更多工具
  ];
}
```

### 4.3 server.ts 中的 handler 包装

```typescript
server.tool(tool.name, tool.description, tool.inputSchema,
  async (args: unknown) => {
    try {
      const result = await tool.handler(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `错误: ${err.message || err}` }],
        isError: true,  // 告诉 MCP 客户端这是错误响应
      };
    }
  }
);
```

这个包装确保任何工具 handler 中抛出的异常都不会导致 MCP 服务器进程崩溃。

---

## 5. 错误处理体系

### 5.1 五层防护

| 层级 | 位置 | 机制 |
|------|------|------|
| L1 连接超时 | openocd-client start() | checkReady 10s 超时 |
| L2 TCP 超时 | connectTelnet() | socket.connect 5s 超时 |
| L3 命令超时 | sendCommand() | 每个命令独立 10s 超时 |
| L4 工具异常 | server.ts handler 包装 | try-catch → isError 响应 |
| L5 进程崩溃 | process.on | unhandledRejection + uncaughtException |

### 5.2 关键设计决策

**checkReady 使用累积缓冲区而非逐块检查:**
```typescript
// 错误做法（字符串可能跨块）:
const checkReady = (data: string) => {
    if (data.includes('Listening on port 4444')) { ... }
};

// 正确做法（累积后查找）:
let readyBuf = '';
const checkReady = (data: string) => {
    readyBuf += data;
    if (readyBuf.includes('Listening on port 4444')) { ... }
};
```

### 5.3 进程清理

```typescript
// Windows: SIGTERM 不可靠，直接用 taskkill
if (process.platform === 'win32') {
    exec(`taskkill /PID ${proc.pid} /T /F`);  // /T = 杀子进程树, /F = 强制
} else {
    proc.kill('SIGTERM');
    setTimeout(() => proc.kill('SIGKILL'), 2000);  // 兜底
}
```

---

## 6. Telnet IAC 处理

### 6.1 IAC 协议

Telnet 使用 IAC (Interpret As Command) 字节 0xFF 进行带内信令:

| 序列 | 含义 |
|------|------|
| `\xff\xfb\x03` | WILL SUPPRESS GO AHEAD |
| `\xff\xfb\x01` | WILL ECHO |
| `\xff\xfd\x03` | DO SUPPRESS GO AHEAD |
| `\xff\xfe\x01` | DON'T ECHO |

### 6.2 剥离正则

```typescript
const cleaned = data.replace(/\xff[\xfb-\xfe]./g, '');
```

匹配规则:
- `\xff` — IAC 字节
- `[\xfb-\xfe]` — WILL(0xFB) / WONT(0xFC) / DO(0xFD) / DON'T(0xFE)
- `.` — 选项字节（任意字符）

替换为空字符串（不是 `\n`，那会引入多余换行）。

### 6.3 局限性

不处理子协商 SB(0xFA)...SE(0xF0) 序列。OpenOCD 通常不主动发起子协商，所以当前实现足够。

---

## 7. 解析器 (tcl-parser.ts)

### 7.1 parseRegisters

```
输入: (0) r0 (/32): 0x20001000
正则: /^\((\d+)\)\s+(\w+)\s+\(\/\d+\):\s+(0x[0-9a-fA-F]+)/
输出: { number: 0, name: "r0", value: "0x20001000" }
```

只匹配 `\w+` 寄存器名（兼容 `xpsr` 但不兼容含连字符的名称）。

### 7.2 parseMemory

```
输入: 0x08000000: 20001000  或  0x08000004: 0x08001234
正则: /^(0x[0-9a-fA-F]+):\s+((?:0x)?[0-9a-fA-F]+)/
输出: { address: "0x08000000", value: "20001000" }
```

value 的 0x 前缀可选匹配（mdw 不带前缀，某些 OpenOCD 版本带前缀）。

### 7.3 parseFlashBanks

```
输入: #0 : stm32f1x.flash at 0x08000000, size 0x00010000
正则: /^#(\d+)\s*:\s*(\S+)\s+at\s+(0x[0-9a-fA-F]+),\s*size\s+(0x[0-9a-fA-F]+)/
输出: { bank: 0, driver: "stm32f1x.flash", address: "0x08000000", size: "0x00010000" }
```

**已知限制**: STM32G4 系列 OpenOCD 使用 `stm32l4x` 驱动名，正则 `\S+` 能匹配，但返回的 driver 字段可能不是预期的 `stm32g4x.flash`。

---

## 8. 配置系统

### 8.1 配置优先级（从高到低）

```
工具参数 > process.env.OPENOCD_xxx > defaultConfig 参数 > 硬编码默认值
```

### 8.2 硬编码默认值

| 变量 | 默认值 | 说明 |
|------|--------|------|
| OPENOCD_BIN | 'openocd' | 从 PATH 查找 |
| OPENOCD_SCRIPTS | 'C:/Program Files/OpenOCD/openocd/scripts' | Windows 默认，跨平台需修改 |
| OPENOCD_INTERFACE | 'stlink' | ST-Link 调试器 |
| OPENOCD_TARGET | 'stm32f1x' | 保守默认值 |

### 8.3 MCP 配置文件 (.mcp.json)

```json
{
  "mcpServers": {
    "openocd": {
      "command": "node",
      "args": ["D:/Temp/AI_Test/openocd-mcp/dist/server.js"],
      "env": {
        "OPENOCD_BIN": "C:/Program Files/OpenOCD/bin/openocd.exe",
        "OPENOCD_SCRIPTS": "C:/Program Files/OpenOCD/openocd/scripts",
        "OPENOCD_INTERFACE": "stlink",
        "OPENOCD_TARGET": "stm32g4x"
      }
    }
  }
}
```

同时需要在 `settings.local.json` 中加 `"enabledMcpjsonServers": ["openocd"]`。

---

## 9. 已知限制

1. **并发 sendCommand**: 不支持，同时只能有一个命令在途（单 `pendingResolve` 槽位）
2. **端口冲突**: 旧进程残留时 start() 会超时而非自动清理
3. **跨平台路径**: scriptsDir 默认值硬编码 Windows 路径
4. **Telnet 子协商**: IAC 过滤器不处理 SB/SE 子协商序列
5. **parseFlashBanks**: STM32G4 系列驱动名不匹配，banks 数组可能为空
6. **monitor_memory**: `mdh` 输出格式解析可能失败，建议用 `mdw`
7. **集成测试**: 需要完整重写以适应 TCP Socket mock 架构

---

## 10. 重新实现检查清单

按此顺序创建文件:

1. **package.json**: type=module, 依赖 @modelcontextprotocol/sdk + zod, dev 依赖 vitest + typescript
2. **tsconfig.json**: target ES2022, module Node16, strict=true
3. **src/tools/types.ts**: Tool 接口
4. **src/openocd-client.ts**: OpenOCDClient 类（核心，~225 行）
5. **src/tcl-parser.ts**: 三个解析函数
6. **src/tools/config.ts**: createConfigTools
7. **src/tools/flash.ts**: createFlashTools
8. **src/tools/debug.ts**: createDebugTools
9. **src/tools/monitor.ts**: createMonitorTools
10. **src/tools/raw.ts**: createRawTool
11. **src/server.ts**: main() 入口，McpServer + 注册全部工具
12. **src/__tests__/**: openocd-client.test.ts + tcl-parser.test.ts

关键顺序: openocd-client.ts 必须在所有 tools 文件之前实现，因为 tools 都依赖它。
