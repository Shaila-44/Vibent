/**
 * Reads and validates environment configuration.
 * Missing optional credentials are allowed (TMDB falls back to demo mode,
 * OpenAI falls back to rule-based interpretation); malformed values fail fast.
 */

class ConfigError extends Error {}

const PLACEHOLDER = /^(your[_-]|<|changeme|xxx)/i;

function readSecret(value) {
  const trimmed = (value || '').trim();
  if (!trimmed || PLACEHOLDER.test(trimmed)) return null;
  return trimmed;
}

function readInt(env, name, fallback, { min, max }) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function loadConfig(env = process.env) {
  return {
    nodeEnv: env.NODE_ENV || 'development',
    port: readInt(env, 'PORT', 3000, { min: 1, max: 65535 }),
    tmdbApiKey: readSecret(env.TMDB_API_KEY),
    tmdbTimeoutMs: readInt(env, 'TMDB_TIMEOUT_MS', 8000, { min: 500, max: 60000 }),
    openaiApiKey: readSecret(env.OPENAI_API_KEY),
    openaiModel: (env.OPENAI_MODEL || 'gpt-4o-mini').trim(),
    openaiTimeoutMs: readInt(env, 'OPENAI_TIMEOUT_MS', 10000, { min: 500, max: 60000 }),
    trustProxy: env.TRUST_PROXY === 'true'
  };
}

module.exports = { loadConfig, ConfigError };
