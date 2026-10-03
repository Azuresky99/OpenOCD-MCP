# OpenOCD MCP 服务器 — 安装指南

> **版本:** 1.0.0 | **作者:** 碧云天书 驱使 Claude Code + Deepseek pro v4 | **日期:** 2026-06-22

## 前提条件

| 软件 | 最低版本 | 检查命令 |
|------|----------|----------|
| Node.js | 18+ | `node --version` |
| [OpenOCD](https://github.com/xpack-dev-tools/openocd-xpack/releases) | 0.12.0+ (xPack 发行版) | `openocd --version` |
| ST-Link 驱动 | 最新 | 设备管理器 → STM32 STLink |
| Windows | 10/11 | — |

---

## 一、全新安装

以下以安装包解压路径在`D:\openocd-mcp`，准备安装到 `C:\Program Files\OpenOCD-MCP\` 为例。

### Step 1: 创建目录并复制文件

以**管理员身份**打开 PowerShell（Program Files 需要管理员权限）：

```powershell
New-Item -ItemType Directory -Path "C:\Program Files\OpenOCD-MCP" -Force

Copy-Item -Path "D:\openocd-mcp\*" `
          -Destination "C:\Program Files\OpenOCD-MCP\" `
          -Exclude "node_modules","dist",".git",".sdd" `
          -Recurse -Force
```

### Step 2: 进入目录

```powershell
cd "C:\Program Files\OpenOCD-MCP"
```

### Step 3: 安装依赖

```bash
npm install
```
> 如果执行报错，尝试先执行 `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` 命令提升权限，然后再安装依赖。

### Step 4: 编译

```bash
npm run build
```

### Step 5: 验证

```bash
npm test
```

预期输出：

```
Test Files  2 passed (2)
Tests       8 passed (8)
```

---

## 二、配置 Claude Code

安装完成后，需要配置 Claude Code 才能使用。有两种方式可选。

### 方式 A：项目级配置（只在当前项目生效）

在需要调试 STM32 的**项目根目录**下创建 `.mcp.json`：

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

并在同目录的 `.claude\settings.local.json` 中添加：

```json
{
  "enabledMcpjsonServers": ["openocd"]
}
```

### 方式 B：全局配置（所有项目可用，推荐）

在用户目录 `C:\Users\你的用户名\.claude\settings.json` 中添加：

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

此后**任何目录**启动 Claude Code 都能使用 OpenOCD MCP。

### 环境变量说明

| 环境变量 | 含义 | 如何修改 |
|----------|------|----------|
| `OPENOCD_BIN` | OpenOCD 可执行文件完整路径 | OpenOCD 安装位置不同时修改 |
| `OPENOCD_SCRIPTS` | OpenOCD 脚本目录 | 同上 |
| `OPENOCD_INTERFACE` | 调试器类型 | `stlink` / `jlink` / `cmsis-dap` |
| `OPENOCD_TARGET` | 目标芯片系列 | 根据**实际使用芯片**改为 `stm32f1x` / `stm32f4x` / `stm32g4x` / `stm32h7x` 等 |

---

## 三、验证安装

重启 Claude Code，在对话中输入：

```
查看 openocd 工具列表
```

如果看到 19 个 `mcp__openocd__*` 工具，安装成功。

然后连接硬件测试：

```
连接 STM32 硬件
```

看到 `Examination succeed` 即一切正常。

---

## 四、卸载

```powershell
# 1. 从 Claude Code 配置中移除相关条目
# 编辑 C:\Users\你的用户名\.claude\settings.json
# 删除 mcpServers.openocd 和 enabledMcpjsonServers 中的 "openocd"

# 2. 删除安装目录
Remove-Item -Path "C:\Program Files\OpenOCD-MCP" -Recurse -Force
```

---

## 五、升级

```bash
cd "C:\Program Files\OpenOCD-MCP"
git pull                    # 拉取最新代码
npm install                 # 更新依赖（如有变化）
npm run build               # 重新编译
```

重启 Claude Code 即可。
