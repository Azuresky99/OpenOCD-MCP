# OpenOCD MCP Server

> **Version:** 1.0.0 | **Author:** Bluesky(碧云天书), driven by Claude Code + Deepseek pro v4 | **Date:** 2026-06-21

An AI assistant can use OpenOCD to flash and debug STM32 microcontrollers via the MCP protocol.


## Prerequisites

- **OpenOCD** installed (xPack OpenOCD 0.12.0+ recommended)
- **ST-Link** debugger (or another supported debugger such as J-Link or CMSIS-DAP)
- **STM32** development board (F1/F4/G0/G4/H7 series, etc.)
- **Node.js** 18+


## Project-Level Installation

This example assumes the OpenOCD MCP server files have been extracted to the `C:\OpenOCD-MCP` directory.

```bash
cd "C:\OpenOCD-MCP"
npm install
npm run build
```


## Environment Variables

The configuration tool connects to the target chip through OpenOCD. You can customize the default values via environment variables (optional, to simplify `openocd_start` calls):

| Environment Variable | Default Value | Description |
|---------|--------|------|
| `OPENOCD_BIN` | `openocd` | Path to the OpenOCD executable |
| `OPENOCD_SCRIPTS` | Auto-detected | Directory containing the script files |
| `OPENOCD_INTERFACE` | `stlink` | Debugger interface type |
| `OPENOCD_TARGET` | `stm32f1x` | Target chip series |


### Windows Example (PowerShell)
```powershell
$env:OPENOCD_BIN="C:\Program Files\OpenOCD\bin\openocd.exe"
$env:OPENOCD_SCRIPTS="C:\Program Files\OpenOCD\openocd\scripts"
$env:OPENOCD_INTERFACE="stlink"
$env:OPENOCD_TARGET="stm32f1x"
```

## Integration with Claude Code

Create a `.mcp.json` in the project root directory:

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

Then add the following to `.claude/settings.local.json`:

```json
"enabledMcpjsonServers": ["openocd"]
```

This automatically approves the MCP server and avoids prompting every time.

> Note 1: To change the default chip series (for example, to STM32F4), simply change the `OPENOCD_TARGET` value in `.mcp.json` from `"stm32f1x"` to `"stm32f4x"`.
> Note 2: If you use **Claude Code**, the settings in `.mcp.json` take **higher priority than** the environment variable defaults; the settings in `.mcp.json` will override the environment variable defaults.

### Global Installation (Available to All Projects)

The configuration above only takes effect within the current project directory. If you want **the OpenOCD MCP to be available when starting Claude Code from any directory**, you need to promote the MCP configuration to the user level.

**Step 1:** Add the following to the user directory `~\.claude\settings.json` (typically `C:\Users\your-username\.claude\settings.json`):

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

**Step 2:** Restart Claude Code. From then on, the OpenOCD MCP tools will load automatically no matter which directory you start from.

> Note: The project-level `.mcp.json` configuration is **merged** with the global configuration, not overridden by it. You only need to configure the same MCP server once (choose either project-level or global level).


## Usage Workflow


### 1. Start the Connection

First call `openocd_start` to connect to the target chip:
```
AI: openocd_start { "interface": "stlink", "target": "stm32f1x" }
```

### 2. Flash Firmware

```
AI: flash_write { "file": "C:/firmware.bin", "address": "0x08000000", "verify": true }
```

### 3. Debug

```
AI: debug_halt {}
AI: monitor_registers {}
AI: debug_set_breakpoint { "address": "0x08001234", "hw": true }
AI: debug_resume {}
```

### 4. Close the Connection

```
AI: openocd_stop {}
```

## Full Tool List

### Connection Management

| Tool | Parameters | Description |
|------|------|------|
| `openocd_start` | `interface?`(string) `target?`(string) `speed?`(number) | Start OpenOCD and connect to the target chip |
| `openocd_stop` | No parameters | Safely close the OpenOCD connection |
| `openocd_status` | No parameters | Query the current connection status and chip information |

### Flash Tools

| Tool | Parameters | Description |
|------|------|------|
| `flash_write` | `file`(string) `address?`(string) `verify?`(boolean) | Flash firmware to Flash (supports .bin/.hex/.elf), with optional verification |
| `flash_erase` | `bank?`(number) `address?`(string) `length?`(string) | Erase Flash contents |
| `flash_read` | `address`(string) `length`(string) `outputFile?`(string) | Read Flash contents to a file or return hex data |
| `flash_info` | No parameters | Query Flash information (Bank, size, write-protection status) |

### Debug Tools

| Tool | Parameters | Description |
|------|------|------|
| `debug_halt` | No parameters | Halt the CPU |
| `debug_resume` | No parameters | Resume execution |
| `debug_step` | `count?`(number) | Single-step execute instructions |
| `debug_reset` | `type`(enum: run/halt/init) | Reset the CPU, with optional post-reset state |
| `debug_set_breakpoint` | `address`(string) `hw?`(boolean) | Set a breakpoint |
| `debug_remove_breakpoint` | `address`(string) | Remove a breakpoint |
| `debug_list_breakpoints` | No parameters | List all breakpoints |

### Monitor Tools

| Tool | Parameters | Description |
|------|------|------|
| `monitor_registers` | `cpu?`(number) | Read all CPU registers (R0-R15, CPSR, etc.) |
| `monitor_register` | `name`(string) | Read a single CPU register value (such as pc, sp, lr, r0) |
| `monitor_memory` | `address`(string) `length`(string) `format?`(hex/word) | Read memory data at the specified address |
| `monitor_chip_info` | No parameters | Read information about the connected chip (chip ID, Flash size, etc.) |

### Pass-Through Tool

| Tool | Parameters | Description |
|------|------|------|
| `openocd_command` | `command`(string) `timeout?`(number) | Send any arbitrary Tcl command directly to OpenOCD |

## Development Commands

```bash
npm install        # Install dependencies
npm run build      # Compile TypeScript
npm test           # Run tests (no hardware required)
npm run dev        # Development mode (tsx hot reload)
```

### Hardware Testing

Requires an STM32 development board and an ST-Link connected.

```bash
npx tsx test-hardware.ts
```


## Directory Structure

```
openocd-mcp/
├── src/
│   ├── server.ts              # MCP server entry point
│   ├── openocd-client.ts      # OpenOCD subprocess manager
│   ├── tcl-parser.ts          # Tcl response parser
│   ├── tools/
│   │   ├── config.ts          # Connection management tools (start/stop/status)
│   │   ├── flash.ts           # Flash tools (write/erase/read/info)
│   │   ├── debug.ts           # Debug tools (halt/resume/step/reset/bp)
│   │   ├── monitor.ts         # Monitor tools (registers/memory/chip)
│   │   └── raw.ts             # Pass-through tool (raw Tcl command)
│   └── __tests__/
│       ├── openocd-client.test.ts
│       └── tcl-parser.test.ts
├── dist/                      # Compilation output
├── package.json
├── tsconfig.json
└── README.md
```


## FAQ

**Q: Startup fails with "Error: openocd not found"**
A: Check whether the `OPENOCD_BIN` environment variable points to the full path of the OpenOCD executable.

**Q: Connection fails with "Error: init mode failed"**
A: Check whether the debugger wiring (SWDIO/SWCLK/GND) is correct and confirm that the driver is installed. Try lowering the `speed` parameter.

**Q: Flashing fails with "Error: flash protected"**
A: You need to call `flash_erase` first to erase the chip, or use `openocd_command` to run `stm32f1x unlock 0` to unlock it.

**Q: Command times out**
A: When flashing large files, you can pass the `timeout` parameter through `openocd_command` to increase the timeout value.


## Documentation Set

| Document | Target Audience | Content |
|------|------|------|
| README.md | Quick start | Installation, configuration, tool list |
| ARCHITECTURE.md | Developers | Architecture design, communication protocol, core algorithms, checklists |
| MANUAL.md | Everyone (including beginners) | Zero-background concept explanations, detailed principles, wiring diagrams, operation examples, reference for all 19 tools, troubleshooting guide |
| Install.md | Installation instructions | Installation, project-level configuration, and global configuration |
