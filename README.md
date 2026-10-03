# OpenOCD MCP 服务器

> **版本:** 1.0.0 | **作者:** 碧云天书 驱使 Claude Code + Deepseek pro v4 | **日期:** 2026-06-21  

AI 助手可以通过 MCP 协议使用 OpenOCD 对 STM32 微控制器进行烧录和调试。


## 前提条件

- **OpenOCD** 已安装（推荐 xPack OpenOCD 0.12.0+）
- **ST-Link** 调试器（或其他支持的调试器如 J-Link、CMSIS-DAP）
- **STM32** 开发板（F1/F4/G0/G4/H7 等系列）
- **Node.js** 18+


## 项目级安装

以OpenOCD MCP服务器文件解压保存在`C:\OpenOCD-MCP`目录为例

```bash
cd "C:\OpenOCD-MCP"
npm install
npm run build
```


## 环境变量

配置工具通过 OpenOCD 连接到目标芯片。可通过环境变量自定义默认值（可选，用于简化 `openocd_start` 调用）：

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `OPENOCD_BIN` | `openocd` | OpenOCD 可执行文件路径 |
| `OPENOCD_SCRIPTS` | 自动检测 | 脚本文件所在目录 |
| `OPENOCD_INTERFACE` | `stlink` | 调试器接口类型 |
| `OPENOCD_TARGET` | `stm32f1x` | 目标芯片系列 |  


### Windows 示例（PowerShell）
```powershell
$env:OPENOCD_BIN="C:\Program Files\OpenOCD\bin\openocd.exe"
$env:OPENOCD_SCRIPTS="C:\Program Files\OpenOCD\openocd\scripts"
$env:OPENOCD_INTERFACE="stlink"
$env:OPENOCD_TARGET="stm32f1x"
```

## 与 Claude Code 集成

在项目根目录创建 `.mcp.json`：

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
        "OPENOCD_TARGET": "stm32f1x"
      }
    }
  }
}
```

然后在 `.claude/settings.local.json` 中添加：

```json
"enabledMcpjsonServers": ["openocd"]
```

以自动批准该 MCP 服务器，避免每次询问。

> 注1：如果要修改默认芯片系列（比如换成 STM32F4），只需将 .mcp.json 中 `OPENOCD_TARGET` 的值由 `"stm32f1x"` 改为 `"stm32f4x"`。  
> 注2：如果使用**Claude Code**，.mcp.json 设置的**优先级高于**环境变量自定义默认值，.mcp.json 内的设置会覆盖环境变量默认值。

### 全局安装（所有项目可用）

以上配置只在当前项目目录生效。如果你希望**在任何目录启动 Claude Code 都能使用 OpenOCD MCP**，需要将 MCP 配置提升到用户级别。

**Step 1:** 在用户目录 `~\.claude\settings.json`（通常为 `C:\Users\你的用户名\.claude\settings.json`）中添加：

```json
{
  "enabledMcpjsonServers": ["openocd"],
  "mcpServers": {
    "openocd": {
      "command": "node",
      "args": ["D:/Temp/AI_Test/openocd-mcp/dist/server.js"],
      "env": {
        "OPENOCD_BIN": "C:/Program Files/OpenOCD/bin/openocd.exe",
        "OPENOCD_SCRIPTS": "C:/Program Files/OpenOCD/openocd/scripts",
        "OPENOCD_INTERFACE": "stlink",
        "OPENOCD_TARGET": "stm32f1x"
      }
    }
  }
}
```

**Step 2:** 重启 Claude Code。此后无论从哪个目录启动，OpenOCD MCP 工具都会自动加载。

> 注：项目级的 `.mcp.json` 配置会与全局配置**合并**，不会相互覆盖。同一个 MCP 服务器只需配置一次（项目级或全局级二选一）。


## 使用流程


### 1. 启动连接

先调用 `openocd_start` 连接到目标芯片：
```
AI: openocd_start { "interface": "stlink", "target": "stm32f1x" }
```

### 2. 烧录固件

```
AI: flash_write { "file": "C:/firmware.bin", "address": "0x08000000", "verify": true }
```

### 3. 调试

```
AI: debug_halt {}
AI: monitor_registers {}
AI: debug_set_breakpoint { "address": "0x08001234", "hw": true }
AI: debug_resume {}
```

### 4. 关闭连接

```
AI: openocd_stop {}
```

## 全部工具列表

### 连接管理

| 工具 | 参数 | 说明 |
|------|------|------|
| `openocd_start` | `interface?`(string) `target?`(string) `speed?`(number) | 启动 OpenOCD 并连接到目标芯片 |
| `openocd_stop` | 无参数 | 安全关闭 OpenOCD 连接 |
| `openocd_status` | 无参数 | 查询当前连接状态和芯片信息 |

### 烧录工具

| 工具 | 参数 | 说明 |
|------|------|------|
| `flash_write` | `file`(string) `address?`(string) `verify?`(boolean) | 烧录固件到 Flash（支持 .bin/.hex/.elf），可选验证 |
| `flash_erase` | `bank?`(number) `address?`(string) `length?`(string) | 擦除 Flash 内容 |
| `flash_read` | `address`(string) `length`(string) `outputFile?`(string) | 读取 Flash 内容到文件或返回 hex 数据 |
| `flash_info` | 无参数 | 查询 Flash 信息（Bank、大小、写保护状态） |

### 调试工具

| 工具 | 参数 | 说明 |
|------|------|------|
| `debug_halt` | 无参数 | 暂停 CPU |
| `debug_resume` | 无参数 | 恢复运行 |
| `debug_step` | `count?`(number) | 单步执行指令 |
| `debug_reset` | `type`(enum: run/halt/init) | 复位 CPU，可选择复位后状态 |
| `debug_set_breakpoint` | `address`(string) `hw?`(boolean) | 设置断点 |
| `debug_remove_breakpoint` | `address`(string) | 移除断点 |
| `debug_list_breakpoints` | 无参数 | 列出所有断点 |

### 监控工具

| 工具 | 参数 | 说明 |
|------|------|------|
| `monitor_registers` | `cpu?`(number) | 读取全部 CPU 寄存器（R0-R15、CPSR 等） |
| `monitor_register` | `name`(string) | 读取单个 CPU 寄存器值（如 pc、sp、lr、r0） |
| `monitor_memory` | `address`(string) `length`(string) `format?`(hex/word) | 读取指定地址的内存数据 |
| `monitor_chip_info` | 无参数 | 读取连接的芯片信息（芯片 ID、Flash 大小等） |

### 透传工具

| 工具 | 参数 | 说明 |
|------|------|------|
| `openocd_command` | `command`(string) `timeout?`(number) | 直接发送任意 Tcl 命令到 OpenOCD |

## 开发命令

```bash
npm install        # 安装依赖
npm run build      # 编译 TypeScript
npm test           # 运行测试（无需硬件）
npm run dev        # 开发模式（tsx 热重载）
```

### 硬件测试

需要连接 STM32 开发板和 ST-Link。

```bash
npx tsx test-hardware.ts
```


## 目录结构

```
openocd-mcp/
├── src/
│   ├── server.ts              # MCP 服务器入口
│   ├── openocd-client.ts      # OpenOCD 子进程管理器
│   ├── tcl-parser.ts          # Tcl 响应解析器
│   ├── tools/
│   │   ├── config.ts          # 连接管理工具（start/stop/status）
│   │   ├── flash.ts           # 烧录工具（write/erase/read/info）
│   │   ├── debug.ts           # 调试工具（halt/resume/step/reset/bp）
│   │   ├── monitor.ts         # 监控工具（registers/memory/chip）
│   │   └── raw.ts             # 透传工具（raw Tcl command）
│   └── __tests__/
│       ├── openocd-client.test.ts
│       └── tcl-parser.test.ts
├── dist/                      # 编译输出
├── package.json
├── tsconfig.json
└── README.md
```


## 常见问题

**Q: 启动失败 "Error: openocd 未找到"**
A: 检查 `OPENOCD_BIN` 环境变量是否指向 OpenOCD 可执行文件的完整路径。

**Q: 连接失败 "Error: init mode failed"**
A: 检查调试器接线（SWDIO/SWCLK/GND）是否正确，确认驱动已安装。可尝试降低 `speed` 参数。

**Q: 烧录失败 "Error: flash protected"**
A: 需要先调用 `flash_erase` 擦除芯片，或使用 `openocd_command` 执行 `stm32f1x unlock 0` 进行解锁。

**Q: 命令超时**
A: 烧录大文件时可通过 `openocd_command` 传递 `timeout` 参数增加超时值。


## 文档体系说明  

| 文档 | 目标读者 | 内容 |
|------|------|------|
| README.md | 快速上手 | 安装、配置、工具列表 |
| ARCHITECTURE.md | 开发者 | 架构设计、通信协议、核心算法、检查清单 |
| MANUAL.md | 所有人（含新手） | 零基础概念解释、原理详解、接线图、操作示例、全部 19 个工具参考、排障指南 |
| Install.md | 安装说明 | 安装、项目级配置和全局配置 |