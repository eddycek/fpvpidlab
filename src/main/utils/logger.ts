import log from 'electron-log';

class Logger {
  constructor() {
    log.transports.file.level = 'info';
    log.transports.console.level = 'debug';
  }

  /** Get the path to the active log file */
  getLogFilePath(): string {
    return log.transports.file.getFile().path;
  }

  error(message: string, ...args: any[]): void {
    log.error(message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    log.warn(message, ...args);
  }

  info(message: string, ...args: any[]): void {
    log.info(message, ...args);
  }

  debug(message: string, ...args: any[]): void {
    log.debug(message, ...args);
  }
}

export const logger = new Logger();
