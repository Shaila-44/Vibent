const { badRequest } = require('./errors');
const { canonicalGenre } = require('../services/genres');

const MAX_MESSAGE_LENGTH = 500;
const MAX_QUERY_LENGTH = 100;
const SORTS = ['popularity.desc', 'vote_average.desc'];
const KINDS = ['discover', 'search', 'similar'];
const MIN_YEAR = 1874;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function toYear(value) {
  const n = Number(value);
  const maxYear = new Date().getFullYear() + 5;
  return Number.isInteger(n) && n >= MIN_YEAR && n <= maxYear ? n : null;
}

/**
 * Coerces untrusted filter objects (from the client's follow-up context or
 * from an LLM) into the shape the TMDB service understands. Unknown or
 * invalid fields are dropped rather than trusted.
 */
function normalizeFilters(raw) {
  if (!isPlainObject(raw)) return null;

  const genres = (Array.isArray(raw.genres) ? raw.genres : [])
    .map(canonicalGenre)
    .filter(Boolean)
    .filter((g, i, all) => all.indexOf(g) === i)
    .slice(0, 3);

  let yearFrom = raw.year_from == null ? null : toYear(raw.year_from);
  let yearTo = raw.year_to == null ? null : toYear(raw.year_to);
  if (yearFrom && yearTo && yearFrom > yearTo) [yearFrom, yearTo] = [yearTo, yearFrom];

  const rating = Number(raw.min_rating);
  const minRating = raw.min_rating != null && rating > 0 && rating <= 10 ? Math.round(rating * 10) / 10 : null;

  const query = typeof raw.query === 'string' ? raw.query.trim().slice(0, MAX_QUERY_LENGTH) : '';
  let kind = KINDS.includes(raw.kind) ? raw.kind : 'discover';
  if (kind !== 'discover' && !query) kind = 'discover';

  return {
    kind,
    genres,
    genre_match: raw.genre_match === 'any' ? 'any' : 'all',
    year_from: yearFrom,
    year_to: yearTo,
    min_rating: minRating,
    sort_by: SORTS.includes(raw.sort_by) ? raw.sort_by : 'popularity.desc',
    query: kind === 'discover' ? null : query,
    mood: typeof raw.mood === 'string' ? raw.mood.slice(0, 30) : null
  };
}

function toBoundedInt(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Validates POST /api/chat bodies. Returns { message, context }. */
function validateChatBody(body) {
  if (!isPlainObject(body)) {
    throw badRequest('Request body must be a JSON object with a "message" field.');
  }
  if (typeof body.message !== 'string') {
    throw badRequest('"message" must be a string.');
  }
  const message = body.message.trim();
  if (!message) throw badRequest('Please type a message first.', 'EMPTY_MESSAGE');
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw badRequest(`Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`, 'MESSAGE_TOO_LONG');
  }

  let context = null;
  if (body.context != null) {
    if (!isPlainObject(body.context)) throw badRequest('"context" must be an object.');
    const filters = normalizeFilters(body.context.filters);
    const page = toBoundedInt(body.context.page, 1, 500);
    const offset = toBoundedInt(body.context.offset ?? 0, 0, 19);
    if (!filters || page === null || offset === null) {
      throw badRequest('"context" is malformed.');
    }
    context = { filters, page, offset };
  }

  return { message, context };
}

module.exports = { validateChatBody, normalizeFilters, MAX_MESSAGE_LENGTH };
