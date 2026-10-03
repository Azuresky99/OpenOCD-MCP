# OpenOCD MCP Server — Installation Guide

> **Version:** 1.0.0 | **Author:** Bluesky(碧云天书), driven by Claude Code + Deepseek pro v4 | **Date:** 2026-06-22

## Prerequisites

| Software | Minimum Version | Check Command |
|------|----------|----------|
| Node.js | 18+ | `node --version` |
| [OpenOCD](https://github.com/xpack-dev-tools/openocd-xpack/releases) | 0.12.0+ (xPack distribution) | `openocd --version` |
| ST-Link Driver | Latest | Device Manager → STM32 STLink |
| Windows | 10/11 | — |

---

## Part One — Fresh Installation

The following assumes the installation package has been extracted to `D:\openocd-mcp` and will be installed to `C:\Program Files\OpenOCD-MCP\`.

### Step 1: Create the directory and copy the files

Open PowerShell **as administrator** (Program Files requires administrator privileges):

```powershell
New-Item -ItemType Directory -Path "C:\Program Files\OpenOCD-MCP" -Force

Copy-Item -Path "D:\openocd-mcp\*" `
          -Destination "C:\Program Files\OpenOCD-MCP\" `
          -Exclude "node_modules","dist",".git",".sdd" `
          -Recurse -Force
```

### Step 2: Enter the directory

```powershell
cd "C:\Program Files\OpenOCD-MCP"
```

### Step 3: Install dependencies

```bash
npm install
```
> If the command errors out, try running `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` first to elevate permissions, then install the dependencies again.

### Step 4: Compile

```bash
npm run build
```

### Step 5: Verify

```bash
npm test
```

Expected output:

```
Test Files  2 passed (2)
Tests       8 passed (8)
```

---

## Part Two — Configuring Claude Code

After installation, you need to configure Claude Code before you can use it. There are two options available.

### Option A: Project-Level Configuration (only effective in the current project)

Create `.mcp.json` in the **project root directory** where you need to debug the STM32:

```json
{
  "mcpServers": {
    "openocd": {
      "command": "node",
      "args": ["C:/Program Files/OpenOCD-MCP/dist/server.js"],
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

And add the following to `.claude\settings.local.json` in the same directory:

```json
{
  "enabledMcpjsonServers": ["openocd"]
}
```

### Option B: Global Configuration (available to all projects, recommended)

Add the following to the user directory `C:\Users\your-username\.claude\settings.json`:

```json
{
  "enabledMcpjsonServers": ["openocd"],
  "mcpServers": {
    "openocd": {
      "command": "node",
      "args": ["C:/Program Files/OpenOCD-MCP/dist/server.js"],
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

From then on, the OpenOCD MCP will be available when you start Claude Code from **any directory**.

### Environment Variable Reference

| Environment Variable | Meaning | How to Change |
|----------|------|----------|
| `OPENOCD_BIN` | Full path to the OpenOCD executable | Change if OpenOCD is installed in a different location |
| `OPENOCD_SCRIPTS` | OpenOCD scripts directory | Same as above |
| `OPENOCD_INTERFACE` | Debugger type | `stlink` / `jlink` / `cmsis-dap` |
| `OPENOCD_TARGET` | Target chip series | Change to `stm32f1x` / `stm32f4x` / `stm32g4x` / `stm32h7x`, etc., according to the **chip you actually use** |

---

## Part Three — Verifying the Installation

Restart Claude Code and enter the following in the conversation:

```
Show the openocd tool list
```

If you see 19 `mcp__openocd__*` tools, the installation was successful.

Then connect to the hardware to test:

```
Connect to the STM32 hardware
```

Seeing `Examination succeed` means everything is working properly.

---

## Part Four — Uninstalling

```powershell
# 1. Remove the relevant entries from the Claude Code configuration
# Edit C:\Users\your-username\.claude\settings.json
# Delete mcpServers.openocd and "openocd" from enabledMcpjsonServers

# 2. Delete the installation directory
Remove-Item -Path "C:\Program Files\OpenOCD-MCP" -Recurse -Force
```

---

## Part Five — Upgrading

```bash
cd "C:\Program Files\OpenOCD-MCP"
git pull                    # Pull the latest code
npm install                 # Update dependencies (if changed)
npm run build               # Recompile
```

Then restart Claude Code.
