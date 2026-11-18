const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');

const TEST_KEY = 'test-tmdb-key-123';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function tmdbMovie(id, overrides = {}) {
  return {
    id,
    title: `Movie ${id}`,
    overview: `Overview ${id}`,
    release_date: '2018-05-04',
    vote_average: 7.456,
    vote_count: 1200,
    poster_path: `/poster${id}.jpg`,
    genre_ids: [878, 53],
    ...overrides
  };
}

function tmdbPage(count, { page = 1, total_pages = 1, startId = 1 } = {}) {
  return {
    page,
    total_pages,
    total_results: count,
    results: Array.from({ length: count }, (_, i) => tmdbMovie(startId + i))
  };
}

/** Builds an app whose outbound HTTP calls go to a Jest mock. */
function buildApp(env = {}, fetchImpl = jest.fn()) {
  const config = loadConfig({ TMDB_API_KEY: TEST_KEY, ...env });
  return { app: createApp(config, { fetchImpl }), fetchImpl };
}

function calledUrl(fetchImpl, call = 0) {
  return new URL(String(fetchImpl.mock.calls[call][0]));
}

module.exports = { TEST_KEY, jsonResponse, tmdbMovie, tmdbPage, buildApp, calledUrl };
