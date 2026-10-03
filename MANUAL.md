# OpenOCD MCP 服务器 — 原理说明 + 操作手册


> **版本:** 1.0.0 | **作者:** 碧云天书 驱使 Claude Code + Deepseek pro v4 | **日期:** 2026-06-21

## 零、写给从未接触过的人：几个核心概念

### 什么是 STM32？

STM32 是意法半导体(STMicroelectronics)生产的 32 位 ARM 微控制器(MCU)系列。你可以把它理解为一台指甲盖大小的计算机——有 CPU、内存(RAM)、硬盘(Flash)、各种外设(GPIO、串口、ADC 等)。STM32G474VET6 是其中一款，基于 Cortex-M4 内核，主频 170MHz，512KB Flash，128KB RAM。

程序烧录到 STM32 的 Flash 里，上电后 CPU 从 Flash 中读取指令执行。

### 什么是 ST-Link？

ST-Link 是 ST 官方推出的调试器和编程器。一头通过 USB 连接电脑，另一头通过 SWD(Serial Wire Debug) 接口连接 STM32 芯片。它有两个核心功能：

1. **烧录(Flash)** — 把编译好的程序(.bin/.hex/.elf 文件)写入 STM32 的 Flash
2. **调试(Debug)** — 暂停 CPU、查看寄存器、设置断点、单步执行

ST-Link 是嵌入式开发者的"手术刀"，能看见芯片内部运行状态。

### 什么是 OpenOCD？

[OpenOCD](https://openocd.org/)(Open On-Chip Debugger)是一个开源软件，充当电脑和调试器之间的"翻译官"。它接收调试命令（Tcl 语言），翻译成调试器能理解的协议，再传给 ST-Link 去控制 STM32。

OpenOCD 本身是一个命令行程序，**没有图形界面**。你需要通过 telnet(TCP 端口 4444)连接到它，然后输入 Tcl 命令来控制芯片。

例如，在 telnet 里输入 `halt` → CPU 暂停；输入 `reg` → 显示所有寄存器的值；输入 `resume` → CPU 恢复运行。这些命令和我们 MCP 工具做的事情一模一样。

### 什么是 MCP？

MCP(Model Context Protocol) 是 Anthropic 制定的一个标准协议，让 AI 助手（比如 Claude Code）可以调用外部工具。MCP 服务器是一个独立进程，通过标准输入输出(stdio)与 Claude Code 通信。服务器声明自己有哪些工具，Claude Code 在需要时调用它们。

我们这个项目做的事：**把 OpenOCD 的 Tcl 命令包装成 MCP 工具，让 AI 可以直接控制 STM32 硬件。**

### 什么是 Vibe Coding？

Vibe Coding 是一种新的编程范式——你不需要手写每一行代码，而是用自然语言描述需求，AI 助手帮你完成实现。本项目就是通过 Vibe Coding 方式构建的：人描述"我要一个 MCP 服务器封装 OpenOCD"，AI 完成全部代码编写、测试、调试。

---

## 一、工作原理详解

### 1.1 整体流程

```
用户 (Claude Code)
  │ "连接 STM32"
  ▼
Claude Code
  │ 调用 MCP 工具: openocd_start
  ▼
MCP 服务器 (Node.js)
  │ 1. spawn OpenOCD 子进程
  │ 2. 等待 telnet 就绪 (检测 "Listening on port 4444")
  │ 3. TCP 连接 127.0.0.1:4444
  │ 4. 发送 Tcl 命令 "targets"
  │ 5. 返回芯片信息
  ▼
OpenOCD (子进程)
  │ 通过 USB → ST-Link → SWD → STM32
  │ 返回: Cortex-M4 r0p1 detected
  ▼
结果返回给用户
```

### 1.2 为什么要用 TCP telnet 而不是直接 stdin？

这是本项目踩过的最大的坑。最初设计是通过 stdin 管道直接向 OpenOCD 发送 Tcl 命令，但在 Windows 上完全不可行。原因：

1. OpenOCD 在 Windows 上的输出使用 CRLF(`\r\n`) 换行
2. Tcl 提示符是 `\r> `（回车+大于号+空格），而不是 Linux 的 `\n> `
3. Node.js 的 child_process spawn 在 Windows 上的管道行为与 Linux 不同
4. 输出数据可能跨块分割，逐块检查字符串会遗漏

最终改用了 OpenOCD 内置的 telnet 服务器（端口 4444）。这是 OpenOCD 官方支持的交互方式，协议语义明确。

### 1.3 Telnet 协议和 IAC 字节

Telnet 协议使用 `0xFF`（十进制 255）作为命令前缀，称为 IAC(Interpret As Command)。OpenOCD 在建立 telnet 连接时会发送几个协商序列：

| 原始字节 | 含义 | 处理方式 |
|----------|------|----------|
| `\xff\xfb\x03` | 我方 WILL SUPPRESS GO AHEAD | 剥离 |
| `\xff\xfb\x01` | 我方 WILL ECHO | 剥离 |
| `\xff\xfd\x03` | 请求对方 DO SUPPRESS GO AHEAD | 剥离 |
| `\xff\xfe\x01` | 请求对方 DON'T ECHO | 剥离 |

这些字节如果不剥离，会混入 Tcl 响应中导致解析失败。我们的处理方式是用正则 `/\xff[\xfb-\xfe]./g` 匹配并删除。

### 1.4 提示符检测机制

OpenOCD 的 telnet 服务器在每条 Tcl 命令执行完成后输出提示符 `\r> `。我们的程序通过检测这个提示符来判断命令是否执行完毕。

```
发送 "targets\r\n" 到 telnet
    ↓
OpenOCD 执行命令
    ↓
输出: "targets\r\n     TargetName    ...\r\n 0* stm32g4x.cpu ...\r\n\r> "
                                                     ↑ 这个就是提示符
    ↓
我们的程序检测到 \r> 
    ↓
提取提示符之前的文本 → 这就是命令的响应
    ↓
返回给调用者
```

**提示符检测必须用累积缓冲区**——这是另一个踩过的坑。最初用逐块检测（每次 `data` 事件到达时单独检查），但如果 "Listening on port 4444" 这个字符串恰好跨两个数据块分割，就永远检测不到，导致程序无限等待。修复方法是把每次到达的数据追加到一个累积字符串中，每次检查完整累积字符串。

### 1.5 命令响应中包含什么？

以 `targets` 命令为例，telnet 返回的原始数据:

```
targets\r\n
\x00    TargetName         Type       Endian TapName            State       
--  ------------------ ---------- ------ ------------------ ------------
 0* stm32g4x.cpu       cortex_m   little stm32g4x.cpu       running\r\n
\r> 
```

其中:
- `targets\r\n` — 命令回显（OpenOCD 会回显输入的命令）
- `\x00` — NULL 字节，telnet 协议中的 Go-Ahead 标记
- 后面是格式化的表格数据
- `\r> ` — 提示符，标志响应结束

我们的 `handleOutput` 会把 IAC 剥离后的数据追加到缓冲区，检测到 `\r> ` 后把提示符之前的全部内容作为命令响应返回。调用者拿到的是**整个会话的累积文本**。

---

## 二、安装与配置

### 2.1 前提条件

| 软件 | 版本要求 | 如何检查 |
|------|----------|----------|
| Node.js | 18+ | `node --version` |
| OpenOCD | 0.12.0+ (推荐 xPack 发行版) | `openocd --version` |
| ST-Link 驱动 | 最新版 | 设备管理器 → 通用串行总线设备 → STM32 STLink |
| STM32 开发板 | STM32F1/F4/G0/G4/H7 系列均可 | 肉眼观察芯片丝印 |
| 杜邦线 | SWD 需要 4 根线 | SWDIO, SWCLK, GND, 可选 VCC |

### 2.2 接线

STM32 开发板上通常有 4 针 SWD 接口，标注为:

```
ST-Link          STM32 开发板
┌──────┐         ┌──────┐
│SWDIO ├─────────┤SWDIO │  (数据线)
│SWCLK ├─────────┤SWCLK │  (时钟线)
│GND   ├─────────┤GND   │  (地线)
│3.3V  ├─────────┤VCC   │  (供电，可选)
└──────┘         └──────┘
```

如果开发板已经通过 USB 供电，3.3V 可以不接。

### 2.3 安装 OpenOCD MCP

```bash
# 1. 进入项目目录
cd D:\Temp\AI_Test\openocd-mcp

# 2. 安装 Node.js 依赖
npm install

# 3. 编译 TypeScript → JavaScript
npm run build

# 4. 验证
npm test
# 应该看到: Test Files 2 passed, Tests 8 passed
```

### 2.4 配置 Claude Code

**Step 1: 创建 `.mcp.json`**

在项目根目录 `D:\Temp\AI_Test\` 下创建 `.mcp.json`:

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

**Step 2: 在 `.claude/settings.local.json` 中添加:**

```json
{
  "enabledMcpjsonServers": ["openocd"]
}
```

**Step 3: 重启 Claude Code**

关闭终端窗口，重新打开。启动时 Claude Code 会自动加载 MCP 服务器。

### 2.5 验证安装

在 Claude Code 中输入:

```
查看 openocd 工具列表
```

如果看到 19 个 `mcp__openocd__*` 工具，说明安装成功。

---

## 三、操作指南

### 3.1 基础操作流程

每次使用遵循这个流程: **启动 → 操作 → 关闭**

```
第 1 步: 启动连接
  AI: 连接 STM32

第 2 步: 执行操作（烧录/调试/监控）
  AI: 暂停 CPU
  AI: 查看寄存器
  AI: 烧录固件 firmware.bin

第 3 步: 关闭连接
  AI: 断开 OpenOCD
```

### 3.2 连接硬件

```
告诉 AI: "连接 STM32 硬件"
```

AI 会自动调用 `openocd_start`，输出类似:

```
STLINK V2J38M27 (API v2) VID:PID 0483:374B
[stm32g4x.cpu] Cortex-M4 r0p1 processor detected
[stm32g4x.cpu] target has 6 breakpoints, 4 watchpoints
[stm32g4x.cpu] Examination succeed
Listening on port 3333 for gdb connections
Listening on port 4444 for telnet connections
```

看到 "Examination succeed" 即连接成功。

**常见问题**: 如果提示 "libusb_open() failed with LIBUSB_ERROR_ACCESS":
- 检查 ST-Link USB 线是否插好
- 检查设备管理器中是否能看到 "STM32 STLink"
- 尝试更换 USB 端口
- 如果有多个 ST-Link 连接，拔掉不需要的

### 3.3 查看芯片信息

```
告诉 AI: "查看芯片信息"
```

AI 调用 `monitor_chip_info`，返回设备 ID、Flash 大小、RDP 保护级别等。

### 3.4 调试操作

```
告诉 AI: "暂停 CPU，然后查看寄存器"
```

具体步骤:
1. `debug_halt` — CPU 暂停，返回 PC 和 SP 当前值
2. `monitor_registers` — 读取 R0-R15、xPSR、MSP、PSP、FPU 等

```
告诉 AI: "单步执行 5 条指令"
```

调用 `debug_step`，参数 `count: 5`。

```
告诉 AI: "在 0x08001234 设置硬件断点，然后恢复运行"
```

调用 `debug_set_breakpoint(address="0x08001234", hw=true)` → `debug_resume`。

CPU 执行到 0x08001234 时自动暂停。

```
告诉 AI: "查看所有断点" → "删除 0x08001234 的断点"
```

`debug_list_breakpoints` → `debug_remove_breakpoint`。

### 3.5 烧录固件

```
告诉 AI: "把 D:/firmware.bin 烧录到 STM32"
```

AI 调用 `flash_write`，参数:
- `file: "D:/firmware.bin"`
- `address: "0x08000000"` (STM32 Flash 起始地址)
- `verify: true` (烧录后自动验证)

烧录前会自动擦除对应区域。整个流程: halt → 擦除 → 写入 → 验证 → resume。

**固件格式支持**: .bin（二进制）、.hex（Intel HEX）、.elf（含调试符号）

### 3.6 读取 Flash 内容

```
告诉 AI: "读取 0x08000000 开始的 16KB Flash 内容，保存到 D:/dump.bin"
```

AI 调用 `flash_read`:
- `address: "0x08000000"`
- `length: "0x4000"` (16KB = 0x4000)
- `outputFile: "D:/dump.bin"`

不指定 outputFile 时，AI 会通过 `mdw` 命令返回十六进制数据。

### 3.7 使用底层命令

当高层工具无法满足需求时，可以用透传:

```
告诉 AI: "发送 OpenOCD 命令: stm32l4x unlock 0"
```

AI 调用 `openocd_command(command="stm32l4x unlock 0")`。

常用底层命令:
- `flash write_image erase file.bin 0x08000000` — 手动烧录
- `mdw 0x20000000 32` — 读取 SRAM 32 个字
- `stm32l4x unlock 0` — 解除 Flash 写保护
- `reset halt` — 复位并暂停
- `adapter speed 4000` — 提高调试器速度

---

## 四、全部 19 个工具参考

### 连接管理（3 个）

| 工具 | 参数 | 说明 |
|------|------|------|
| `openocd_start` | `interface?`(string), `target?`(string), `speed?`(number) | 启动 OpenOCD 并连接芯片。interface 可选 stlink/jlink/cmsis-dap，target 如 stm32f1x/stm32f4x/stm32g4x |
| `openocd_stop` | 无 | 安全关闭连接 |
| `openocd_status` | 无 | 查询是否已连接及芯片信息 |

### 烧录工具（4 个）

| 工具 | 参数 | 说明 |
|------|------|------|
| `flash_write` | `file`(string), `address?`(string), `verify?`(bool) | 烧录固件，默认验证 |
| `flash_erase` | `bank?`(number), `address?`(string), `length?`(string) | 擦除 Flash。不指定参数则全片擦除 Bank 0 |
| `flash_read` | `address`(string), `length`(string), `outputFile?`(string) | 读取 Flash。有 outputFile 保存到文件，无则返回 hex 数据 |
| `flash_info` | 无 | 查询 Flash Bank 信息、写保护状态 |

### 调试工具（7 个）

| 工具 | 参数 | 说明 |
|------|------|------|
| `debug_halt` | 无 | 暂停 CPU |
| `debug_resume` | 无 | 恢复运行 |
| `debug_step` | `count?`(number) | 单步，默认 1 步 |
| `debug_reset` | `type`("run"/"halt"/"init") | 复位。halt=复位后暂停，init=执行初始化脚本 |
| `debug_set_breakpoint` | `address`(string), `hw?`(bool) | 设置断点。hw=true 用硬件断点(有限个)，false 用软件断点 |
| `debug_remove_breakpoint` | `address`(string) | 删除断点 |
| `debug_list_breakpoints` | 无 | 列出所有断点 |

### 监控工具（4 个）

| 工具 | 参数 | 说明 |
|------|------|------|
| `monitor_registers` | `cpu?`(number) | 读取全部 CPU 核心寄存器(R0-R15, xPSR, MSP, PSP, FPU 等)。CPU 需暂停 |
| `monitor_register` | `name`(string) | 读取单个寄存器，如 pc/sp/lr/r0 |
| `monitor_memory` | `address`(string), `length`(string), `format?`("hex"/"word") | 读取内存。hex=半字 hex，word=全字 |
| `monitor_chip_info` | 无 | 芯片 ID、Flash 大小、RDP 保护级别 |

### 透传工具（1 个）

| 工具 | 参数 | 说明 |
|------|------|------|
| `openocd_command` | `command`(string), `timeout?`(number) | 直接发送任意 Tcl 命令，超时默认 10000ms |

---

## 五、常见问题与排障

### Q1: "OpenOCD 已在运行中，请先调用 stop()"

原因: 上一次连接没有正常关闭，或者 OpenOCD 进程残留。

解决: 告诉 AI "先断开 OpenOCD，再重新连接"。

### Q2: "libusb_open() failed with LIBUSB_ERROR_ACCESS"

原因: Windows 的 ST-Link 驱动不兼容 libusb。

解决:
1. 下载并运行 [Zadig](https://zadig.akeo.ie/) 工具
2. 在设备列表中选择 "STM32 STLink"
3. 将驱动替换为 "WinUSB"
4. 重新插拔 ST-Link

注意: 替换驱动后，STM32 CubeProgrammer 等 ST 官方工具可能无法识别设备。可以用 Zadig 切换回来。

### Q3: 连接后命令超时

原因: 可能端口 4444 被旧进程占用，或者 USB 连接不稳定。

解决:
```
告诉 AI: "检查端口 4444 和残留 OpenOCD 进程"
```

AI 会杀掉残留进程，释放端口。

### Q4: "target voltage may be too low"

原因: ST-Link 检测到目标板电压过低(通常 < 1.5V)。

解决:
- 确保 STM32 开发板已供电(USB 或外部电源)
- 检查 SWD 接口的 VCC 引脚电压
- 如果只是警告(不是 Error)，可以忽略

### Q5: 烧录失败 "flash protected"

原因: Flash 写保护已启用。

解决: 
```
告诉 AI: "解除 STM32 Flash 写保护"
```

AI 会执行 `openocd_command(command="stm32l4x unlock 0")` (G4 系列)。

对于 F1/F4 系列: `openocd_command(command="stm32f1x unlock 0")`。

### Q6: 如何烧录 .hex 文件？

`flash_write` 支持 .hex 格式，直接指定文件路径即可。OpenOCD 根据文件扩展名自动识别格式。

### Q7: 如何知道 STM32 的芯片型号？

```
告诉 AI: "查看芯片信息"
```

返回的 device idcode 可以查表确定型号。例如 0x20036469 = STM32G474VET6。

### Q8: 技术支持

- OpenOCD 官方文档: http://openocd.org/doc/html/
- 技术栈 [《OpenOCD 嵌入式调试完全指南：从零开始调试 GD32/STM32 单片机》](https://jishuzhan.net/article/2056171648579637249)
- STM32G4 参考手册: [RM0440](https://www.st.com.cn/resource/en/reference_manual/rm0440-stm32g4-series-advanced-armbased-32bit-mcus-stmicroelectronics.pdf)
- 本项目架构文档: [ARCHITECTURE.md](ARCHITECTURE.md)
- 项目 README: [README.md](README.md)

---

## 六、开发者指南

### 6.1 项目结构

```
openocd-mcp/
├── ARCHITECTURE.md    ← 架构设计文档
├── MANUAL.md          ← 本文档
├── README.md          ← 项目简介
├── package.json       ← Node.js 项目配置
├── tsconfig.json      ← TypeScript 编译配置
├── src/
│   ├── server.ts              ← MCP 入口
│   ├── openocd-client.ts      ← OpenOCD 通信核心
│   ├── tcl-parser.ts          ← 响应解析器
│   └── tools/
│       ├── types.ts           ← 共享类型
│       ├── config.ts          ← 连接管理
│       ├── flash.ts           ← 烧录工具
│       ├── debug.ts           ← 调试工具
│       ├── monitor.ts         ← 监控工具
│       └── raw.ts             ← 透传工具
├── dist/               ← 编译产物 (npm run build)
└── src/__tests__/
    ├── openocd-client.test.ts ← 单元测试
    └── tcl-parser.test.ts     ← 解析器测试
```

### 6.2 开发命令

```bash
npm install          # 安装依赖
npm run build        # 编译 TypeScript → dist/
npm test             # 运行测试
npm run dev          # 开发模式 (热重载)
```

### 6.3 添加新工具

1. 在对应的 `src/tools/xxx.ts` 中添加新对象到返回数组
2. 遵循现有模式: `{ name, description, inputSchema, handler }`
3. handler 参数使用内联类型声明
4. 编译: `npm run build`
5. 重启 Claude Code

### 6.4 调试技巧

如果 MCP 服务器异常:
1. 检查 CLI 输出中的红色错误信息
2. 检查是否残留 OpenOCD 进程 (任务管理器)
3. 检查端口占用: `netstat -ano | findstr 4444`
4. 手动测试 OpenOCD: `openocd -f interface/stlink.cfg -f target/stm32g4x.cfg`
5. 查看 dist/server.js 是否最新: `npm run build`
