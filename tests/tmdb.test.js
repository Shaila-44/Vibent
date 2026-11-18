const { createTmdbClient, discoverParams, toMovie } = require('../src/services/tmdb.service');
const { normalizeFilters } = require('../src/utils/validators');
const { jsonResponse, tmdbPage, calledUrl } = require('./helpers');

const filters = (raw) => normalizeFilters({ kind: 'discover', ...raw });

describe('discoverParams', () => {
  test('maps genres, years, rating and sort to TMDB discover parameters', () => {
    const params = discoverParams(filters({
      genres: ['Comedy', 'Romance'],
      year_from: 2000,
      year_to: 2010,
      min_rating: 7,
      sort_by: 'vote_average.desc'
    }), 2);
    expect(params).toMatchObject({
      with_genres: '35,10749',
      'primary_release_date.gte': '2000-01-01',
      'primary_release_date.lte': '2010-12-31',
      'vote_average.gte': '7',
      sort_by: 'vote_average.desc',
      'vote_count.gte': '300',
      page: '2'
    });
  });

  test('uses OR (|) for "any" genre matches and excludes unreleased films by default', () => {
    const params = discoverParams(filters({ genres: ['Mystery', 'Thriller'], genre_match: 'any' }), 1);
    expect(params.with_genres).toBe('9648|53');
    expect(params['primary_release_date.lte']).toBe(new Date().toISOString().slice(0, 10));
    expect(params['vote_count.gte']).toBe('50');
  });
});

describe('toMovie', () => {
  test('handles missing poster, rating and title fields', () => {
    expect(toMovie({ id: 7, original_title: 'Original', genre_ids: [99, 12345] })).toEqual({
      id: 7,
      title: 'Original',
      overview: '',
      release_date: null,
      rating: null,
      vote_count: null,
      poster_path: null,
      poster_url: null,
      genres: ['Documentary'],
      tmdb_url: 'https://www.themoviedb.org/movie/7'
    });
  });
});

describe('createTmdbClient', () => {
  test('discover returns normalised results and paging info', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(tmdbPage(2, { total_pages: 4 })));
    const client = createTmdbClient({ apiKey: 'k', fetchImpl });
    const page = await client.discover(filters({ genres: ['Action'] }));
    expect(page.results.map((m) => m.title)).toEqual(['Movie 1', 'Movie 2']);
    expect(page.total_pages).toBe(4);
    expect(calledUrl(fetchImpl).searchParams.get('with_genres')).toBe('28');
  });

  test('caches identical requests', async () => {
    const fetchImpl = jest.fn().mockImplementation(async () => jsonResponse(tmdbPage(1)));
    const client = createTmdbClient({ apiKey: 'k', fetchImpl });
    await client.search('Alien');
    await client.search('Alien');
    await client.search('Aliens');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('does not cache failures', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse(tmdbPage(1)));
    const client = createTmdbClient({ apiKey: 'k', fetchImpl });
    await expect(client.search('Alien')).rejects.toMatchObject({ status: 502 });
    await expect(client.search('Alien')).resolves.toMatchObject({ results: [expect.any(Object)] });
  });

  test('handles an empty search', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ page: 1, total_pages: 0, results: [] }));
    const client = createTmdbClient({ apiKey: 'k', fetchImpl });
    await expect(client.search('nothing')).resolves.toEqual({ results: [], page: 1, total_pages: 0 });
  });

  test('similar() returns no results without a second call when the title is unknown', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ page: 1, total_pages: 0, results: [] }));
    const client = createTmdbClient({ apiKey: 'k', fetchImpl });
    await expect(client.similar('nothing')).resolves.toMatchObject({ results: [], basedOn: null });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('details() includes runtime and tagline', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ id: 1, title: 'X', runtime: 95, tagline: 'Hi', genres: [{ id: 35, name: 'Comedy' }] }));
    const client = createTmdbClient({ apiKey: 'k', fetchImpl });
    await expect(client.details(1)).resolves.toMatchObject({ runtime: 95, tagline: 'Hi', genres: ['Comedy'] });
  });

  test('requires an API key', () => {
    expect(() => createTmdbClient({ apiKey: null })).toThrow();
  });
});
