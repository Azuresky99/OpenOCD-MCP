# OpenOCD MCP Server — Principles + Operation Manual


> **Version:** 1.0.0 | **Author:** Bluesky(碧云天书), driven by Claude Code + Deepseek pro v4 | **Date:** 2026-06-21

## Part Zero — For Those Who Have Never Touched This Before: A Few Core Concepts

### What Is STM32?

STM32 is a family of 32-bit ARM microcontrollers (MCUs) manufactured by STMicroelectronics. You can think of it as a computer the size of a fingernail — it has a CPU, memory (RAM), "disk" (Flash), and various peripherals (GPIO, UART, ADC, etc.). The STM32G474VET6 is one such model, based on the Cortex-M4 core, running at 170MHz, with 512KB Flash and 128KB RAM.

The program is flashed into the STM32's Flash, and after power-up the CPU reads instructions from Flash and executes them.

### What Is ST-Link?

ST-Link is the official debugger and programmer from ST. One end connects to the computer via USB, and the other end connects to the STM32 chip via the SWD (Serial Wire Debug) interface. It has two core functions:

1. **Flashing** — writes the compiled program (.bin/.hex/.elf file) into the STM32's Flash
2. **Debugging** — halts the CPU, inspects registers, sets breakpoints, single-steps execution

ST-Link is the embedded developer's "scalpel" — it lets you see the chip's internal runtime state.

### What Is OpenOCD?

[OpenOCD](https://openocd.org/) (Open On-Chip Debugger) is open-source software that acts as a "translator" between the computer and the debugger. It receives debug commands (in the Tcl language), translates them into a protocol the debugger understands, and passes them to the ST-Link to control the STM32.

OpenOCD itself is a command-line program — it has **no graphical interface**. You need to connect to it via telnet (TCP port 4444) and then enter Tcl commands to control the chip.

For example, entering `halt` in telnet → the CPU halts; entering `reg` → displays the values of all registers; entering `resume` → the CPU resumes running. These commands do exactly the same thing as our MCP tools.

### What Is MCP?

MCP (Model Context Protocol) is a standard protocol defined by Anthropic that lets AI assistants (such as Claude Code) call external tools. An MCP server is a standalone process that communicates with Claude Code through standard input/output (stdio). The server declares which tools it has, and Claude Code invokes them when needed.

What this project does: **wrap OpenOCD's Tcl commands into MCP tools so that the AI can directly control STM32 hardware.**

### What Is Vibe Coding?

Vibe Coding is a new programming paradigm — you don't need to hand-write every line of code; instead, you describe your requirements in natural language, and an AI assistant helps you complete the implementation. This project was built through Vibe Coding: a human described "I want an MCP server that wraps OpenOCD," and the AI did all of the code writing, testing, and debugging.

---

## Part One — How It Works in Detail

### 1.1 Overall Flow

```
User (Claude Code)
  │ "Connect to STM32"
  ▼
Claude Code
  │ invokes MCP tool: openocd_start
  ▼
MCP Server (Node.js)
  │ 1. spawn OpenOCD subprocess
  │ 2. wait for telnet to be ready (detect "Listening on port 4444")
  │ 3. TCP connect to 127.0.0.1:4444
  │ 4. send Tcl command "targets"
  │ 5. return chip information
  ▼
OpenOCD (subprocess)
  │ via USB → ST-Link → SWD → STM32
  │ returns: Cortex-M4 r0p1 detected
  ▼
Result returned to the user
```

### 1.2 Why Use TCP Telnet Instead of Direct stdin?

This was the biggest pitfall this project ran into. The initial design sent Tcl commands directly to OpenOCD through a stdin pipe, but this was completely infeasible on Windows. The reasons:

1. OpenOCD's output on Windows uses CRLF (`\r\n`) line endings
2. The Tcl prompt is `\r> ` (carriage return + greater-than sign + space), rather than Linux's `\n> `
3. Node.js child_process spawn's pipe behavior on Windows differs from Linux
4. Output data may be split across chunks, so checking strings chunk-by-chunk misses things

Ultimately, we switched to OpenOCD's built-in telnet server (port 4444). This is OpenOCD's officially supported interaction method, with clear protocol semantics.

### 1.3 The Telnet Protocol and IAC Bytes

The telnet protocol uses `0xFF` (decimal 255) as a command prefix, called IAC (Interpret As Command). OpenOCD sends several negotiation sequences when establishing a telnet connection:

| Raw Bytes | Meaning | Handling |
|----------|------|----------|
| `\xff\xfb\x03` | We WILL SUPPRESS GO AHEAD | Strip |
| `\xff\xfb\x01` | We WILL ECHO | Strip |
| `\xff\xfd\x03` | Request peer DO SUPPRESS GO AHEAD | Strip |
| `\xff\xfe\x01` | Request peer DON'T ECHO | Strip |

If these bytes are not stripped, they get mixed into the Tcl response and cause parsing failures. Our approach is to match and delete them with the regex `/\xff[\xfb-\xfe]./g`.

### 1.4 Prompt Detection Mechanism

OpenOCD's telnet server outputs the prompt `\r> ` after each Tcl command finishes executing. Our program detects this prompt to determine whether a command has completed.

```
Send "targets\r\n" to telnet
    ↓
OpenOCD executes the command
    ↓
Output: "targets\r\n     TargetName    ...\r\n 0* stm32g4x.cpu ...\r\n\r> "
                                                     ↑ this is the prompt
    ↓
Our program detects \r> 
    ↓
Extract the text before the prompt → this is the command's response
    ↓
Return it to the caller
```

**Prompt detection must use an accumulating buffer** — this is another pitfall we ran into. Initially we used chunk-by-chunk detection (checking separately each time a `data` event arrived), but if the string "Listening on port 4444" happened to be split across two data chunks, it would never be detected, causing the program to wait indefinitely. The fix was to append each arriving chunk of data to an accumulating string and check the full accumulated string each time.

### 1.5 What Does the Command Response Contain?

Taking the `targets` command as an example, the raw data returned by telnet:

```
targets\r\n
\x00    TargetName         Type       Endian TapName            State       
--  ------------------ ---------- ------ ------------------ ------------
 0* stm32g4x.cpu       cortex_m   little stm32g4x.cpu       running\r\n
\r> 
```

Where:
- `targets\r\n` — the command echo (OpenOCD echoes back the entered command)
- `\x00` — a NULL byte, the Go-Ahead marker in the telnet protocol
- followed by the formatted table data
- `\r> ` — the prompt, marking the end of the response

Our `handleOutput` appends the IAC-stripped data to the buffer, and after detecting `\r> ` returns everything before the prompt as the command response. What the caller receives is **the accumulated text of the entire session**.

---

## Part Two — Installation and Configuration

### 2.1 Prerequisites

| Software | Version Requirement | How to Check |
|------|----------|----------|
| Node.js | 18+ | `node --version` |
| OpenOCD | 0.12.0+ (xPack distribution recommended) | `openocd --version` |
| ST-Link Driver | Latest version | Device Manager → Universal Serial Bus devices → STM32 STLink |
| STM32 Development Board | STM32F1/F4/G0/G4/H7 series all work | Visually inspect the chip silkscreen |
| Jumper Wires | SWD requires 4 wires | SWDIO, SWCLK, GND, optional VCC |

### 2.2 Wiring

STM32 development boards usually have a 4-pin SWD interface, labeled:

```
ST-Link          STM32 Development Board
┌──────┐         ┌──────┐
│SWDIO ├─────────┤SWDIO │  (data line)
│SWCLK ├─────────┤SWCLK │  (clock line)
│GND   ├─────────┤GND   │  (ground line)
│3.3V  ├─────────┤VCC   │  (power, optional)
└──────┘         └──────┘
```

If the development board is already powered via USB, the 3.3V connection can be omitted.

### 2.3 Installing the OpenOCD MCP

```bash
# 1. Enter the project directory
cd D:\Temp\AI_Test\openocd-mcp

# 2. Install Node.js dependencies
npm install

# 3. Compile TypeScript → JavaScript
npm run build

# 4. Verify
npm test
# You should see: Test Files 2 passed, Tests 8 passed
```

### 2.4 Configuring Claude Code

**Step 1: Create `.mcp.json`**

Create `.mcp.json` under the project root `D:\Temp\AI_Test\`:

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

**Step 2: Add the following to `.claude/settings.local.json`:**

```json
{
  "enabledMcpjsonServers": ["openocd"]
}
```

**Step 3: Restart Claude Code**

Close the terminal window and reopen it. On startup, Claude Code will automatically load the MCP server.

### 2.5 Verifying the Installation

Enter the following in Claude Code:

```
Show the openocd tool list
```

If you see 19 `mcp__openocd__*` tools, the installation was successful.

---

## Part Three — Operation Guide

### 3.1 Basic Operation Workflow

Each use follows this workflow: **start → operate → close**

```
Step 1: Start the connection
  AI: Connect to STM32

Step 2: Perform operations (flash/debug/monitor)
  AI: Halt the CPU
  AI: View registers
  AI: Flash the firmware firmware.bin

Step 3: Close the connection
  AI: Disconnect OpenOCD
```

### 3.2 Connecting to the Hardware

```
Tell the AI: "Connect to the STM32 hardware"
```

The AI will automatically call `openocd_start`, outputting something like:

```
STLINK V2J38M27 (API v2) VID:PID 0483:374B
[stm32g4x.cpu] Cortex-M4 r0p1 processor detected
[stm32g4x.cpu] target has 6 breakpoints, 4 watchpoints
[stm32g4x.cpu] Examination succeed
Listening on port 3333 for gdb connections
Listening on port 4444 for telnet connections
```

Seeing "Examination succeed" means the connection was successful.

**Common Problem**: If you get "libusb_open() failed with LIBUSB_ERROR_ACCESS":
- Check whether the ST-Link USB cable is properly plugged in
- Check whether "STM32 STLink" is visible in Device Manager
- Try a different USB port
- If multiple ST-Links are connected, unplug the ones you don't need

### 3.3 Viewing Chip Information

```
Tell the AI: "View the chip information"
```

The AI calls `monitor_chip_info`, returning the device ID, Flash size, RDP protection level, etc.

### 3.4 Debugging Operations

```
Tell the AI: "Halt the CPU, then view the registers"
```

Specific steps:
1. `debug_halt` — the CPU halts, returning the current values of PC and SP
2. `monitor_registers` — reads R0-R15, xPSR, MSP, PSP, FPU, etc.

```
Tell the AI: "Single-step 5 instructions"
```

Call `debug_step` with the parameter `count: 5`.

```
Tell the AI: "Set a hardware breakpoint at 0x08001234, then resume execution"
```

Call `debug_set_breakpoint(address="0x08001234", hw=true)` → `debug_resume`.

The CPU automatically halts when execution reaches 0x08001234.

```
Tell the AI: "View all breakpoints" → "Remove the breakpoint at 0x08001234"
```

`debug_list_breakpoints` → `debug_remove_breakpoint`.

### 3.5 Flashing Firmware

```
Tell the AI: "Flash D:/firmware.bin to the STM32"
```

The AI calls `flash_write` with parameters:
- `file: "D:/firmware.bin"`
- `address: "0x08000000"` (the STM32 Flash starting address)
- `verify: true` (automatically verify after flashing)

The corresponding region is automatically erased before flashing. The whole flow: halt → erase → write → verify → resume.

**Supported Firmware Formats**: .bin (binary), .hex (Intel HEX), .elf (with debug symbols)

### 3.6 Reading Flash Contents

```
Tell the AI: "Read 16KB of Flash starting at 0x08000000, save to D:/dump.bin"
```

The AI calls `flash_read`:
- `address: "0x08000000"`
- `length: "0x4000"` (16KB = 0x4000)
- `outputFile: "D:/dump.bin"`

When outputFile is not specified, the AI returns the hex data via the `mdw` command.

### 3.7 Using Low-Level Commands

When the high-level tools can't meet a need, you can use pass-through:

```
Tell the AI: "Send OpenOCD command: stm32l4x unlock 0"
```

The AI calls `openocd_command(command="stm32l4x unlock 0")`.

Common low-level commands:
- `flash write_image erase file.bin 0x08000000` — manual flashing
- `mdw 0x20000000 32` — read 32 words of SRAM
- `stm32l4x unlock 0` — remove Flash write protection
- `reset halt` — reset and halt
- `adapter speed 4000` — increase the debugger speed

---

## Part Four — Reference for All 19 Tools

### Connection Management (3)

| Tool | Parameters | Description |
|------|------|------|
| `openocd_start` | `interface?`(string), `target?`(string), `speed?`(number) | Start OpenOCD and connect to the chip. interface can be stlink/jlink/cmsis-dap; target such as stm32f1x/stm32f4x/stm32g4x |
| `openocd_stop` | none | Safely close the connection |
| `openocd_status` | none | Query whether connected and the chip information |

### Flash Tools (4)

| Tool | Parameters | Description |
|------|------|------|
| `flash_write` | `file`(string), `address?`(string), `verify?`(bool) | Flash firmware; verifies by default |
| `flash_erase` | `bank?`(number), `address?`(string), `length?`(string) | Erase Flash. With no parameters, performs a full-chip erase of Bank 0 |
| `flash_read` | `address`(string), `length`(string), `outputFile?`(string) | Read Flash. With outputFile, saves to a file; without, returns hex data |
| `flash_info` | none | Query Flash Bank information and write-protection status |

### Debug Tools (7)

| Tool | Parameters | Description |
|------|------|------|
| `debug_halt` | none | Halt the CPU |
| `debug_resume` | none | Resume execution |
| `debug_step` | `count?`(number) | Single-step; defaults to 1 step |
| `debug_reset` | `type`("run"/"halt"/"init") | Reset. halt=halt after reset, init=run the initialization script |
| `debug_set_breakpoint` | `address`(string), `hw?`(bool) | Set a breakpoint. hw=true uses a hardware breakpoint (limited number), false uses a software breakpoint |
| `debug_remove_breakpoint` | `address`(string) | Remove a breakpoint |
| `debug_list_breakpoints` | none | List all breakpoints |

### Monitor Tools (4)

| Tool | Parameters | Description |
|------|------|------|
| `monitor_registers` | `cpu?`(number) | Read all CPU core registers (R0-R15, xPSR, MSP, PSP, FPU, etc.). The CPU must be halted |
| `monitor_register` | `name`(string) | Read a single register, such as pc/sp/lr/r0 |
| `monitor_memory` | `address`(string), `length`(string), `format?`("hex"/"word") | Read memory. hex=half-word hex, word=full word |
| `monitor_chip_info` | none | Chip ID, Flash size, RDP protection level |

### Pass-Through Tool (1)

| Tool | Parameters | Description |
|------|------|------|
| `openocd_command` | `command`(string), `timeout?`(number) | Send any arbitrary Tcl command directly; default timeout 10000ms |

---

## Part Five — Common Problems and Troubleshooting

### Q1: "OpenOCD is already running, please call stop() first"

Cause: The previous connection was not closed properly, or an OpenOCD process is lingering.

Solution: Tell the AI "Disconnect OpenOCD first, then reconnect."

### Q2: "libusb_open() failed with LIBUSB_ERROR_ACCESS"

Cause: Windows' ST-Link driver is incompatible with libusb.

Solution:
1. Download and run the [Zadig](https://zadig.akeo.ie/) tool
2. Select "STM32 STLink" in the device list
3. Replace the driver with "WinUSB"
4. Re-plug the ST-Link

Note: After replacing the driver, official ST tools such as STM32 CubeProgrammer may no longer recognize the device. You can use Zadig to switch it back.

### Q3: Commands time out after connecting

Cause: Port 4444 may be occupied by an old process, or the USB connection is unstable.

Solution:
```
Tell the AI: "Check port 4444 and any lingering OpenOCD processes"
```

The AI will kill the lingering process and free the port.

### Q4: "target voltage may be too low"

Cause: The ST-Link detected that the target board's voltage is too low (usually < 1.5V).

Solution:
- Ensure the STM32 development board is powered (USB or external power supply)
- Check the VCC pin voltage on the SWD interface
- If it's only a warning (not an Error), it can be ignored

### Q5: Flashing fails with "flash protected"

Cause: Flash write protection is enabled.

Solution:
```
Tell the AI: "Remove the STM32 Flash write protection"
```

The AI will run `openocd_command(command="stm32l4x unlock 0")` (G4 series).

For the F1/F4 series: `openocd_command(command="stm32f1x unlock 0")`.

### Q6: How do I flash a .hex file?

`flash_write` supports the .hex format; simply specify the file path. OpenOCD automatically recognizes the format based on the file extension.

### Q7: How do I find out the STM32's chip model?

```
Tell the AI: "View the chip information"
```

The returned device idcode can be looked up in a table to determine the model. For example, 0x20036469 = STM32G474VET6.

### Q8: Technical Support

- OpenOCD Official Documentation: http://openocd.org/doc/html/
- Tech Stack [《OpenOCD Embedded Debugging Complete Guide: Debugging GD32/STM32 Microcontrollers from Scratch》](https://jishuzhan.net/article/2056171648579637249)
- STM32G4 Reference Manual: [RM0440](https://www.st.com.cn/resource/en/reference_manual/rm0440-stm32g4-series-advanced-armbased-32bit-mcus-stmicroelectronics.pdf)
- This Project's Architecture Document: [ARCHITECTURE.md](ARCHITECTURE.md)
- Project README: [README.md](README.md)

---

## Part Six — Developer Guide

### 6.1 Project Structure

```
openocd-mcp/
├── ARCHITECTURE.md    ← Architecture design document
├── MANUAL.md          ← This document
├── README.md          ← Project overview
├── package.json       ← Node.js project configuration
├── tsconfig.json      ← TypeScript compilation configuration
├── src/
│   ├── server.ts              ← MCP entry point
│   ├── openocd-client.ts      ← OpenOCD communication core
│   ├── tcl-parser.ts          ← Response parser
│   └── tools/
│       ├── types.ts           ← Shared types
│       ├── config.ts          ← Connection management
│       ├── flash.ts           ← Flash tools
│       ├── debug.ts           ← Debug tools
│       ├── monitor.ts         ← Monitor tools
│       └── raw.ts             ← Pass-through tool
├── dist/               ← Compilation output (npm run build)
└── src/__tests__/
    ├── openocd-client.test.ts ← Unit tests
    └── tcl-parser.test.ts     ← Parser tests
```

### 6.2 Development Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript → dist/
npm test             # Run tests
npm run dev          # Development mode (hot reload)
```

### 6.3 Adding a New Tool

1. Add a new object to the returned array in the corresponding `src/tools/xxx.ts`
2. Follow the existing pattern: `{ name, description, inputSchema, handler }`
3. Use inline type declarations for handler parameters
4. Compile: `npm run build`
5. Restart Claude Code

### 6.4 Debugging Tips

If the MCP server misbehaves:
1. Check the red error messages in the CLI output
2. Check whether any lingering OpenOCD processes exist (Task Manager)
3. Check port usage: `netstat -ano | findstr 4444`
4. Test OpenOCD manually: `openocd -f interface/stlink.cfg -f target/stm32g4x.cfg`
5. Check whether dist/server.js is up to date: `npm run build`
