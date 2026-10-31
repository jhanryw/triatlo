import { LOG_LEVELS, type LogLevel } from "./config";

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export type LogSink = (line: string) => void;

/** Structured JSON logs, one per line. Callers must never pass secrets or health data in `fields`. */
export function createLogger(level: LogLevel, sink: LogSink = (line) => console.log(line)): Logger {
  const threshold = LOG_LEVELS.indexOf(level);
  const write = (lineLevel: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (LOG_LEVELS.indexOf(lineLevel) < threshold) return;
    sink(JSON.stringify({ time: new Date().toISOString(), level: lineLevel, service: "triatlo-worker", message, ...fields }));
  };
  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}
