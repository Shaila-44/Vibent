/**
 * Thin TMDB v3 client: discover, search, recommendations and details.
 *
 * - Accepts either a v3 API key (sent as ?api_key=) or a v4 read access token
 *   (a JWT, sent as a Bearer header). Neither is ever returned to clients.
 * - Every request has a timeout and maps failures to safe AppErrors.
 * - Responses are cached in memory for a short time to avoid repeat calls
 *   (e.g. when the user asks for "more" from the same page).
 */
const { AppError } = require('../utils/errors');
const { GENRES, ID_TO_NAME } = require('./genres');
const logger = require('../utils/logger');

const API_BASE = 'https://api.themoviedb.org/3';
// TMDB image base (images.secure_base_url from GET /configuration) and a card-sized width.
const IMAGE_BASE = 'https://image.tmdb.org/t/p/';
const POSTER_SIZE = 'w342';
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;

function posterUrl(path) {
  return path ? `${IMAGE_BASE}${POSTER_SIZE}${path}` : null;
}

/** Normalises a TMDB movie result into the shape the frontend renders. */
function toMovie(raw) {
  return {
    id: raw.id,
    title: raw.title || raw.original_title || 'Untitled',
    overview: raw.overview || '',
    release_date: raw.release_date || null,
    rating: typeof raw.vote_average === 'number' ? Math.round(raw.vote_average * 10) / 10 : null,
    vote_count: raw.vote_count ?? null,
    poster_path: raw.poster_path || null,
    poster_url: posterUrl(raw.poster_path),
    genres: Array.isArray(raw.genres)
      ? raw.genres.map((g) => g.name)
      : (raw.genre_ids || []).map((id) => ID_TO_NAME[id]).filter(Boolean),
    tmdb_url: `https://www.themoviedb.org/movie/${raw.id}`
  };
}

function toPage(data) {
  return {
    results: (Array.isArray(data?.results) ? data.results : []).map(toMovie),
    page: data?.page || 1,
    total_pages: Math.min(data?.total_pages || 0, 500)
  };
}

/** Builds /discover/movie query params from normalised filters. */
function discoverParams(filters, page) {
  const params = {
    include_adult: 'false',
    include_video: 'false',
    language: 'en-US',
    page: String(page),
    sort_by: filters.sort_by,
    // Rating sorts need a vote floor, otherwise 10/10 films with 3 votes win.
    'vote_count.gte': filters.sort_by === 'vote_average.desc' ? '300' : '50'
  };
  if (filters.genres.length) {
    params.with_genres = filters.genres.map((g) => GENRES[g]).join(filters.genre_match === 'any' ? '|' : ',');
  }
  if (filters.year_from) params['primary_release_date.gte'] = `${filters.year_from}-01-01`;
  if (filters.year_to) params['primary_release_date.lte'] = `${filters.year_to}-12-31`;
  if (!filters.year_to) {
    // Exclude unreleased films, which have no ratings yet.
    params['primary_release_date.lte'] = new Date().toISOString().slice(0, 10);
  }
  if (filters.min_rating) params['vote_average.gte'] = String(filters.min_rating);
  return params;
}

function createTmdbClient({ apiKey, timeoutMs = 8000, fetchImpl = (...a) => fetch(...a) }) {
  if (!apiKey) throw new Error('createTmdbClient requires an apiKey');
  const isBearer = apiKey.startsWith('eyJ');
  const cache = new Map();

  async function request(path, params = {}) {
    const url = new URL(API_BASE + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const cacheKey = url.toString();

    const hit = cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.data;

    if (!isBearer) url.searchParams.set('api_key', apiKey);
    const headers = { Accept: 'application/json' };
    if (isBearer) headers.Authorization = `Bearer ${apiKey}`;

    let res;
    try {
      res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        logger.warn(`TMDB ${path} timed out after ${timeoutMs}ms`);
        throw new AppError(504, 'TMDB_TIMEOUT', 'The movie database took too long to respond. Please try again.');
      }
      logger.warn(`TMDB ${path} network error: ${err.message}`);
      throw new AppError(502, 'TMDB_UNAVAILABLE', "I couldn't reach the movie database right now. Please try again shortly.");
    }

    if (!res.ok) {
      logger.warn(`TMDB ${path} responded ${res.status}`);
      if (res.status === 401) {
        throw new AppError(502, 'TMDB_AUTH_FAILED', 'The movie database rejected our credentials. The server needs a valid TMDB API key.');
      }
      if (res.status === 404) throw new AppError(404, 'NOT_FOUND', "I couldn't find that movie.");
      if (res.status === 429) {
        throw new AppError(503, 'TMDB_RATE_LIMITED', 'The movie database is busy right now. Please wait a moment and try again.');
      }
      throw new AppError(502, 'TMDB_UNAVAILABLE', "I couldn't reach the movie database right now. Please try again shortly.");
    }

    let data;
    try {
      data = await res.json();
    } catch {
      throw new AppError(502, 'TMDB_BAD_RESPONSE', 'The movie database sent an unexpected response.');
    }

    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { data, expires: Date.now() + CACHE_TTL_MS });
    return data;
  }

  const client = {
    source: 'tmdb',

    async discover(filters, page = 1) {
      return toPage(await request('/discover/movie', discoverParams(filters, page)));
    },

    async search(query, page = 1) {
      return toPage(await request('/search/movie', {
        query, include_adult: 'false', language: 'en-US', page: String(page)
      }));
    },

    /** Finds the best match for a title, then returns TMDB's recommendations for it. */
    async similar(title, page = 1) {
      const matches = await client.search(title);
      const base = matches.results[0];
      if (!base) return { results: [], page: 1, total_pages: 0, basedOn: null };
      const recs = toPage(await request(`/movie/${base.id}/recommendations`, { language: 'en-US', page: String(page) }));
      return { ...recs, basedOn: base };
    },

    async details(id) {
      const data = await request(`/movie/${id}`, { language: 'en-US' });
      return { ...toMovie(data), runtime: data.runtime || null, tagline: data.tagline || '' };
    }
  };
  return client;
}

module.exports = { createTmdbClient, toMovie, discoverParams, posterUrl };
