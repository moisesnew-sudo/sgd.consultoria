const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;
let _currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= (LOG_LEVELS[_currentLevel] || 1);
}

function formatMessage(level: LogLevel, message: string, meta?: any): string {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  if (meta !== undefined) {
    try { return `${prefix} ${message} ${JSON.stringify(meta)}`; } catch { return `${prefix} ${message} [meta]`; }
  }
  return `${prefix} ${message}`;
}

export const logger = {
  debug: (msg: string, meta?: any) => shouldLog('debug') && console.debug(formatMessage('debug', msg, meta)),
  info: (msg: string, meta?: any) => shouldLog('info') && console.log(formatMessage('info', msg, meta)),
  warn: (msg: string, meta?: any) => shouldLog('warn') && console.warn(formatMessage('warn', msg, meta)),
  error: (msg: string, meta?: any) => shouldLog('error') && console.error(formatMessage('error', msg, meta)),
};
