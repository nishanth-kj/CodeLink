export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

/** Where log lines ultimately go. The extension host wires this to a VS Code
 * output channel; tests and other non-VS Code contexts can use `ConsoleSink`
 * or a stub, since this module intentionally never imports `vscode`. */
export interface LogSink {
  write(level: LogLevel, line: string): void;
}

export class ConsoleSink implements LogSink {
  write(level: LogLevel, line: string): void {
    const method = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    method(line);
  }
}

const SENSITIVE_KEY_PATTERN = /token|password|secret|authorization|credential/i;

function redact(meta: unknown): unknown {
  if (Array.isArray(meta)) {
    return meta.map(redact);
  }
  if (meta && typeof meta === "object") {
    const clone: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
      clone[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : redact(value);
    }
    return clone;
  }
  return meta;
}

/**
 * Structured logger used throughout the extension. Never logs access
 * tokens, passwords, secret file contents, or the full process environment;
 * `redact()` strips anything under a suspicious key name defensively, but
 * callers must still avoid passing raw secret values as log messages.
 */
export class Logger {
  private level: LogLevel = "info";

  constructor(
    private readonly sink: LogSink,
    private readonly scope: string = "codelink",
  ) {}

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  child(scope: string): Logger {
    const logger = new Logger(this.sink, `${this.scope}:${scope}`);
    logger.setLevel(this.level);
    return logger;
  }

  error(message: string, meta?: unknown): void {
    this.emit("error", message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.emit("warn", message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.emit("info", message, meta);
  }

  debug(message: string, meta?: unknown): void {
    this.emit("debug", message, meta);
  }

  private emit(level: LogLevel, message: string, meta?: unknown): void {
    if (LEVEL_ORDER[level] > LEVEL_ORDER[this.level]) {
      return;
    }
    const timestamp = new Date().toISOString();
    const metaSuffix = meta === undefined ? "" : ` ${JSON.stringify(redact(meta))}`;
    this.sink.write(level, `[${timestamp}] [${this.scope}] [${level.toUpperCase()}] ${message}${metaSuffix}`);
  }
}
