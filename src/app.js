/**
 * Builds the Express app. Kept separate from src/index.js (which only starts
 * the server) so tests can create isolated app instances.
 */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const logger = require('./utils/logger');
const { createTmdbClient } = require('./services/tmdb.service');
const { createDemoClient } = require('./services/demo-catalog');
const { createOpenAIInterpreter } = require('./services/openai.service');
const { createRecommender } = require('./services/recommendation.service');
const { createChatController } = require('./controllers/chat.controller');
const { createChatRouter } = require('./routes/chat.routes');
const { notFound, errorHandler } = require('./middleware/error.middleware');

function createApp(config, { fetchImpl } = {}) {
  const catalog = config.tmdbApiKey
    ? createTmdbClient({ apiKey: config.tmdbApiKey, timeoutMs: config.tmdbTimeoutMs, fetchImpl })
    : createDemoClient();
  const llm = config.openaiApiKey
    ? createOpenAIInterpreter({
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      timeoutMs: config.openaiTimeoutMs,
      fetchImpl
    })
    : null;
  const recommender = createRecommender({ catalog, llm });
  const controller = createChatController({ recommender, catalog });

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        'img-src': ["'self'", 'data:', 'https://image.tmdb.org'],
        // Only meaningful behind HTTPS; on http://localhost it breaks Safari.
        'upgrade-insecure-requests': config.nodeEnv === 'production' ? [] : null
      }
    }
  }));

  app.use((req, res, next) => {
    const start = Date.now();
    const urlPath = req.path; // captured now: routers rewrite req.url while handling
    res.on('finish', () => {
      if (urlPath.startsWith('/api/')) {
        logger.info(`${req.method} ${urlPath} ${res.statusCode} ${Date.now() - start}ms`);
      }
    });
    next();
  });

  app.use('/api', rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: "You're sending messages too quickly. Please wait a moment." }
    })
  }));
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      source: catalog.source,
      interpreter: llm ? 'openai' : 'rules'
    });
  });
  app.use('/api', createChatRouter(controller));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
