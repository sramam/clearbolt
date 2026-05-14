import pino from "pino";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface Logger {
  child(bindings: Record<string, unknown>): Logger;
  trace(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface Tracer {
  startSpan(
    name: string,
    attrs?: Record<string, string | number | boolean>,
  ): Span;
}

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  end(): void;
}

export interface MetricsSink {
  counter(name: string, value: number, labels?: Record<string, string>): void;
  histogram(name: string, value: number, labels?: Record<string, string>): void;
}

export class NoopTracer implements Tracer {
  startSpan(
    _name: string,
    _attrs?: Record<string, string | number | boolean>,
  ): Span {
    return {
      setAttribute() {},
      end() {},
    };
  }
}

export class NoopMetricsSink implements MetricsSink {
  counter() {}
  histogram() {}
}

/** V0 default: JSON lines to stderr via pino */
export function createPinoLogger(level: LogLevel = "info"): Logger {
  return pino({ level }) as unknown as Logger;
}
