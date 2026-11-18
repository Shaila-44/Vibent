/**
 * Minimal leveled console logger. Silent under Jest unless LOG_LEVEL is set.
 */
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3, silent: -1 };

const configured = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info');
const threshold = LEVELS[configured] ?? LEVELS.info;

function log(level, message) {
  if (threshold < LEVELS[level]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}`;
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

module.exports = {
  error: (m) => log('error', m),
  warn: (m) => log('warn', m),
  info: (m) => log('info', m),
  debug: (m) => log('debug', m)
};
