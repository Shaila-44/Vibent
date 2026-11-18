const request = require('supertest');
const { TEST_KEY, jsonResponse, tmdbPage, tmdbMovie, buildApp, calledUrl } = require('./helpers');

describe('POST /api/chat — valid requests', () => {
  test('interprets the message, calls TMDB discover and returns structured movies', async () => {
    const { app, fetchImpl } = buildApp();
    fetchImpl.mockResolvedValue(jsonResponse(tmdbPage(3)));

    const res = await request(app).post('/api/chat').send({ message: 'Suggest sci-fi movies released after 2015' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.source).toBe('tmdb');
    expect(res.body.message).toMatch(/sci-fi movies released 2016 or later/);
    expect(res.body.movies).toHaveLength(3);
    expect(res.body.movies[0]).toEqual({
      id: 1,
      title: 'Movie 1',
      overview: 'Overview 1',
      release_date: '2018-05-04',
      rating: 7.5,
      vote_count: 1200,
      poster_path: '/poster1.jpg',
      poster_url: 'https://image.tmdb.org/t/p/w342/poster1.jpg',
      genres: ['Science Fiction', 'Thriller'],
      tmdb_url: 'https://www.themoviedb.org/movie/1'
    });
    expect(res.body.interpretation).toMatchObject({ kind: 'discover', genres: ['Science Fiction'], year_from: 2016 });
    expect(res.body.interpreter).toBe('rules');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = calledUrl(fetchImpl);
    expect(url.pathname).toBe('/3/discover/movie');
    expect(url.searchParams.get('with_genres')).toBe('878');
    expect(url.searchParams.get('primary_release_date.gte')).toBe('2016-01-01');
    expect(url.searchParams.get('include_adult')).toBe('false');
  });

  test('never exposes the TMDB API key to the client', async () => {
    const { app, fetchImpl } = buildApp();
    fetchImpl.mockResolvedValue(jsonResponse(tmdbPage(2)));
    const res = await request(app).post('/api/chat').send({ message: 'funny movies' });
    expect(JSON.stringify(res.body)).not.toContain(TEST_KEY);
    expect(calledUrl(fetchImpl).searchParams.get('api_key')).toBe(TEST_KEY);
  });

  test('sends v4 read-access tokens as a Bearer header instead of a query param', async () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.test.token';
    const { app, fetchImpl } = buildApp({ TMDB_API_KEY: token });
    fetchImpl.mockResolvedValue(jsonResponse(tmdbPage(1)));
    await request(app).post('/api/chat').send({ message: 'horror' });
    expect(calledUrl(fetchImpl).searchParams.has('api_key')).toBe(false);
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${token}`);
  });

  test('returns at most 8 movies per reply and pages through results with "show me more"', async () => {
    const { app, fetchImpl } = buildApp();
    fetchImpl.mockImplementation(async (url) => {
      const page = Number(new URL(String(url)).searchParams.get('page'));
      return jsonResponse(tmdbPage(20, { page, total_pages: 3, startId: (page - 1) * 20 + 1 }));
    });

    const first = await request(app).post('/api/chat').send({ message: 'action movies' });
    expect(first.body.movies.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(first.body.next).toMatchObject({ page: 1, offset: 8 });

    const second = await request(app).post('/api/chat').send({ message: 'show me more', context: first.body.next });
    expect(second.body.message).toBe('Here are a few more.');
    expect(second.body.movies.map((m) => m.id)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    // Same TMDB page was served from cache.
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const third = await request(app).post('/api/chat').send({ message: 'more', context: second.body.next });
    expect(third.body.movies.map((m) => m.id)).toEqual([17, 18, 19, 20]);
    expect(third.body.next).toMatchObject({ page: 2, offset: 0 });
  });

  test('"more" without previous context asks for a request first and does not call TMDB', async () => {
    const { app, fetchImpl } = buildApp();
    const res = await request(app).post('/api/chat').send({ message: 'show me more' });
    expect(res.status).toBe(200);
    expect(res.body.movies).toEqual([]);
    expect(res.body.message).toMatch(/Ask me for some movies first/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('"movies like X" searches the title then fetches TMDB recommendations', async () => {
    const { app, fetchImpl } = buildApp();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse({ page: 1, total_pages: 1, results: [tmdbMovie(27205, { title: 'Inception', release_date: '2010-07-15' })] }))
      .mockResolvedValueOnce(jsonResponse(tmdbPage(5, { startId: 100 })));

    const res = await request(app).post('/api/chat').send({ message: 'movies like Inception' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('If you liked Inception (2010), you might enjoy these.');
    expect(res.body.movies).toHaveLength(5);
    expect(calledUrl(fetchImpl, 0).pathname).toBe('/3/search/movie');
    expect(calledUrl(fetchImpl, 0).searchParams.get('query')).toBe('Inception');
    expect(calledUrl(fetchImpl, 1).pathname).toBe('/3/movie/27205/recommendations');
  });

  test('greetings get a help reply with suggestions and no TMDB call', async () => {
    const { app, fetchImpl } = buildApp();
    const res = await request(app).post('/api/chat').send({ message: 'hello' });
    expect(res.body.message).toMatch(/movie recommendation bot/);
    expect(res.body.suggestions.length).toBeGreaterThan(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('non-movie requests are declined honestly', async () => {
    const { app, fetchImpl } = buildApp();
    const res = await request(app).post('/api/chat').send({ message: 'Recommend a good book' });
    expect(res.body.message).toMatch(/only recommend movies/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('POST /api/chat — empty results', () => {
  test('returns success with no movies and a helpful message', async () => {
    const { app, fetchImpl } = buildApp();
    fetchImpl.mockResolvedValue(jsonResponse({ page: 1, total_pages: 0, total_results: 0, results: [] }));

    const res = await request(app).post('/api/chat').send({ message: 'western comedies from 1950' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.movies).toEqual([]);
    expect(res.body.next).toBeNull();
    expect(res.body.message).toMatch(/couldn't find any/);
    expect(res.body.suggestions.length).toBeGreaterThan(0);
  });

  test('an unknown title in "movies like X" says so', async () => {
    const { app, fetchImpl } = buildApp();
    fetchImpl.mockResolvedValue(jsonResponse({ page: 1, total_pages: 0, results: [] }));
    const res = await request(app).post('/api/chat').send({ message: 'films like Qwzxv Plorb' });
    expect(res.body.message).toMatch(/couldn't find a movie called "Qwzxv Plorb"/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/chat — validation', () => {
  let app;
  let fetchImpl;
  beforeEach(() => ({ app, fetchImpl } = buildApp()));
  afterEach(() => expect(fetchImpl).not.toHaveBeenCalled());

  test.each([
    ['empty string', { message: '' }, 'EMPTY_MESSAGE'],
    ['whitespace only', { message: '   \n ' }, 'EMPTY_MESSAGE'],
    ['missing message', {}, 'INVALID_REQUEST'],
    ['non-string message', { message: 42 }, 'INVALID_REQUEST'],
    ['array body', [{ message: 'hi' }], 'INVALID_REQUEST'],
    ['too long', { message: 'a'.repeat(501) }, 'MESSAGE_TOO_LONG'],
    ['malformed context', { message: 'more', context: { page: 'x' } }, 'INVALID_REQUEST']
  ])('rejects %s with 400', async (_label, body, code) => {
    const res = await request(app).post('/api/chat').send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: { code, message: expect.any(String) } });
  });

  test('rejects malformed JSON with 400', async () => {
    const res = await request(app).post('/api/chat').set('Content-Type', 'application/json').send('{"message": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  test('rejects non-JSON bodies with 400', async () => {
    const res = await request(app).post('/api/chat').set('Content-Type', 'text/plain').send('hello');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/chat — TMDB failures', () => {
  test.each([
    ['server error', () => jsonResponse({ status_message: 'boom' }, 500), 502, 'TMDB_UNAVAILABLE'],
    ['bad credentials', () => jsonResponse({ status_message: 'Invalid API key' }, 401), 502, 'TMDB_AUTH_FAILED'],
    ['rate limit', () => jsonResponse({}, 429), 503, 'TMDB_RATE_LIMITED'],
    ['invalid JSON', () => new Response('<html>oops</html>', { status: 200 }), 502, 'TMDB_BAD_RESPONSE']
  ])('maps TMDB %s to a safe error', async (_label, makeResponse, status, code) => {
    const { app, fetchImpl } = buildApp();
    fetchImpl.mockImplementation(async () => makeResponse());

    const res = await request(app).post('/api/chat').send({ message: 'thrillers' });

    expect(res.status).toBe(status);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(code);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(TEST_KEY);
    expect(raw).not.toMatch(/at \w+ \(|stack|boom|Invalid API key/);
  });

  test('maps a timeout to 504', async () => {
    const { app, fetchImpl } = buildApp();
    fetchImpl.mockRejectedValue(Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' }));
    const res = await request(app).post('/api/chat').send({ message: 'thrillers' });
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('TMDB_TIMEOUT');
  });

  test('maps a network error to 502', async () => {
    const { app, fetchImpl } = buildApp();
    fetchImpl.mockRejectedValue(new TypeError('fetch failed'));
    const res = await request(app).post('/api/chat').send({ message: 'thrillers' });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('TMDB_UNAVAILABLE');
  });

  test('passes an abort signal so requests time out', async () => {
    const { app, fetchImpl } = buildApp({ TMDB_TIMEOUT_MS: '1500' });
    fetchImpl.mockResolvedValue(jsonResponse(tmdbPage(1)));
    await request(app).post('/api/chat').send({ message: 'thrillers' });
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('Demo mode (no TMDB key)', () => {
  test('serves clearly labelled sample data without calling any API', async () => {
    const { app, fetchImpl } = buildApp({ TMDB_API_KEY: '' });

    const health = await request(app).get('/api/health');
    expect(health.body).toEqual({ status: 'ok', source: 'demo', interpreter: 'rules' });

    const res = await request(app).post('/api/chat').send({ message: 'Recommend a thriller' });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('demo');
    expect(res.body.movies.length).toBeGreaterThan(0);
    expect(res.body.movies.every((m) => m.tmdb_url === null && m.genres.includes('Thriller'))).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('treats placeholder keys from .env.example as missing', async () => {
    const { app } = buildApp({ TMDB_API_KEY: 'your_tmdb_api_key_here' });
    const health = await request(app).get('/api/health');
    expect(health.body.source).toBe('demo');
  });
});

describe('GET /api/movies/:id', () => {
  test('returns movie details from TMDB', async () => {
    const { app, fetchImpl } = buildApp();
    fetchImpl.mockResolvedValue(jsonResponse({
      ...tmdbMovie(550, { title: 'Fight Club' }),
      genres: [{ id: 18, name: 'Drama' }],
      runtime: 139,
      tagline: 'Mischief. Mayhem. Soap.'
    }));
    const res = await request(app).get('/api/movies/550');
    expect(res.status).toBe(200);
    expect(res.body.movie).toMatchObject({ id: 550, title: 'Fight Club', runtime: 139, genres: ['Drama'] });
    expect(calledUrl(fetchImpl).pathname).toBe('/3/movie/550');
  });

  test('rejects invalid ids without calling TMDB', async () => {
    const { app, fetchImpl } = buildApp();
    const res = await request(app).get('/api/movies/abc');
    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('returns 404 when TMDB has no such movie', async () => {
    const { app, fetchImpl } = buildApp();
    fetchImpl.mockResolvedValue(jsonResponse({ status_message: 'not found' }, 404));
    const res = await request(app).get('/api/movies/999999999');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('App shell', () => {
  test('serves the chat UI with a CSP that allows TMDB images', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('VIBENT');
    expect(res.headers['content-security-policy']).toContain('img-src \'self\' data: https://image.tmdb.org');
  });

  test('unknown API routes return JSON 404', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
