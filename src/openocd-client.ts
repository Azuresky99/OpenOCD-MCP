// OpenOCD MCP Server — OpenOCD 子进程管理 + TCP Telnet 通信
// 版本: 1.0.0  作者: 碧云天书  日期: 2026-06-21
// 许可: MIT License
import { ChildProcess, spawn, exec } from 'node:child_process';
import { Socket } from 'node:net';

export interface OpenOCDConfig {
  openocdBin: string;
  scriptsDir: string;
  interfaceType: string;
  target: string;
  speed?: number;
}

export type OpenOCDState = 'idle' | 'starting' | 'running' | 'error';

export class OpenOCDClient {
  private process: ChildProcess | null = null;
  private state: OpenOCDState = 'idle';
  private buffer = '';
  private pendingResolve: ((value: string) => void) | null = null;
  private pendingReject: ((reason: Error) => void) | null = null;
  private pendingTimeout: NodeJS.Timeout | null = null;
  private socket: Socket | null = null;

  get isRunning(): boolean {
    return this.state === 'running';
  }

  getState(): OpenOCDState {
    return this.state;
  }

  async start(config: OpenOCDConfig): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') {
      throw new Error('OpenOCD 已在运行中，请先调用 stop()');
    }

    this.state = 'starting';
    const args = [
      '-s', config.scriptsDir,
      '-f', `interface/${config.interfaceType}.cfg`,
      '-f', `target/${config.target}.cfg`,
      '-c', 'init',
    ];
    if (config.speed) {
      args.push('-c', `adapter speed ${config.speed}`);
    }

    this.process = spawn(config.openocdBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleOutput(data.toString());
    });
    this.process.stderr?.on('data', (data: Buffer) => {
      this.handleOutput(data.toString());
    });

    this.process.on('exit', (code) => {
      if (this.socket) {
        this.socket.destroy();
        this.socket = null;
      }
      if (this.state === 'running') {
        this.state = 'error';
        if (this.pendingReject) {
          this.pendingReject(new Error(`OpenOCD 进程意外退出，退出码: ${code}`));
          this.clearPending();
        }
      }
      this.process = null;
    });

    // 等待 telnet 服务就绪
    await new Promise<void>((resolve, reject) => {
      let readyBuf = '';
      const timeout = setTimeout(() => {
        reject(new Error('OpenOCD 启动超时（10 秒），请检查调试器连接'));
      }, 10000);

      const checkReady = (data: string) => {
        readyBuf += data;
        if (readyBuf.includes('Listening on port 4444 for telnet connections')) {
          clearTimeout(timeout);
          this.process?.stdout?.off('data', checkReady);
          this.process?.stderr?.off('data', checkReady);
          resolve();
        }
        if (readyBuf.includes('Error:') && !readyBuf.includes('Warn')) {
          clearTimeout(timeout);
          reject(new Error(`OpenOCD 启动错误: ${readyBuf.trim()}`));
        }
      };

      this.process?.stdout?.on('data', checkReady);
      this.process?.stderr?.on('data', checkReady);
    });

    // 连接 telnet
    try {
      await this.connectTelnet();
      this.state = 'running';
    } catch (err) {
      // telnet 连接失败，清理已启动的进程
      if (this.process && this.process.pid) {
        if (process.platform === 'win32') {
          exec(`taskkill /PID ${this.process.pid} /T /F`);
        } else {
          this.process.kill('SIGKILL');
        }
      }
      this.process = null;
      this.state = 'idle';
      throw err;
    }
  }

  private connectTelnet(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new Socket();
      this.socket.setEncoding('utf-8');

      const connectTimeout = setTimeout(() => {
        this.socket?.destroy();
        reject(new Error('Telnet 连接超时（5秒），端口 4444 可能被占用'));
      }, 5000);

      this.socket.on('data', (data: string) => {
        this.handleOutput(data);
      });

      this.socket.on('error', (err) => {
        clearTimeout(connectTimeout);
        reject(new Error(`Telnet 连接失败: ${err.message}`));
      });

      this.socket.connect(4444, '127.0.0.1', () => {
        clearTimeout(connectTimeout);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.state = 'idle';
    const proc = this.process;
    const sock = this.socket;
    this.process = null;
    this.socket = null;

    if (sock) {
      try { sock.write('shutdown\r\n'); } catch { /* ignore */ }
      sock.destroy();
    }

    if (proc && proc.pid) {
      if (process.platform === 'win32') {
        // Windows 上 SIGTERM 不可靠，直接调 taskkill
        exec(`taskkill /PID ${proc.pid} /T /F`);
      } else {
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), 2000);
      }
    }
  }

  async sendCommand(cmd: string, timeoutMs = 10000): Promise<string> {
    if (!this.socket || this.state !== 'running') {
      throw new Error('OpenOCD 未运行，无法发送命令');
    }

    // 清理 buffer 中的旧提示符（\r> 或 \n> ）
    let promptIndex = this.buffer.lastIndexOf('\r> ');
    if (promptIndex === -1) promptIndex = this.buffer.lastIndexOf('\n> ');
    if (promptIndex !== -1) {
      this.buffer = this.buffer.substring(promptIndex + 3);
    }

    return new Promise<string>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;

      this.pendingTimeout = setTimeout(() => {
        reject(new Error(`命令超时（${timeoutMs}ms）: ${cmd}`));
        this.clearPending();
      }, timeoutMs);

      this.socket!.write(cmd + '\r\n');
    });
  }

  async batchCommands(cmds: string[]): Promise<string[]> {
    const results: string[] = [];
    for (const cmd of cmds) {
      results.push(await this.sendCommand(cmd, 60000));
    }
    return results;
  }

  private handleOutput(data: string): void {
    // 剥离 Telnet IAC 协商序列（\xff 后跟 2 字节）
    const cleaned = data.replace(/\xff[\xfb-\xfe]./g, '');
    this.buffer += cleaned;

    // Telnet 提示符：真实硬件使用 \r> （CR），测试 mock 使用 \n> （LF）
    let promptIndex = this.buffer.lastIndexOf('\r> ');
    if (promptIndex === -1) promptIndex = this.buffer.lastIndexOf('\n> ');
    if (promptIndex !== -1 && this.pendingResolve) {
      const result = this.buffer.substring(0, promptIndex).trim();
      // 跳过完整的 "\r> " 提示符（3 个字符）
      this.buffer = this.buffer.substring(promptIndex + 3);
      if (this.pendingTimeout) clearTimeout(this.pendingTimeout);
      this.pendingResolve(result);
      this.clearPending();
    }
  }

  private clearPending(): void {
    this.pendingResolve = null;
    this.pendingReject = null;
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
  }
}
