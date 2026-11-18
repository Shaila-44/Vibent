/**
 * VIBENT - conversational movie recommendations
 * Entry point: loads configuration and starts the HTTP server.
 */
require('dotenv').config();

const { loadConfig, ConfigError } = require('./config');
const { createApp } = require('./app');
const logger = require('./utils/logger');

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    logger.error(`Invalid configuration: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

if (!config.tmdbApiKey) {
  logger.warn('TMDB_API_KEY is not set: running in DEMO MODE with fictional sample movies (not TMDB data).');
}
logger.info(`Message interpretation: ${config.openaiApiKey ? `OpenAI (${config.openaiModel}) with rule-based fallback` : 'rule-based (OPENAI_API_KEY not set)'}`);

const server = createApp(config).listen(config.port, () => {
  logger.info(`VIBENT running at http://localhost:${config.port} (${config.tmdbApiKey ? 'live TMDB data' : 'demo mode'})`);
});

server.on('error', (err) => {
  logger.error(err.code === 'EADDRINUSE'
    ? `Port ${config.port} is already in use. Set PORT in .env to use another port.`
    : `Server error: ${err.message}`);
  process.exit(1);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
