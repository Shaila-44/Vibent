const request = require('supertest');
const { createOpenAIInterpreter } = require('../src/services/openai.service');
const { loadConfig } = require('../src/config');
const { jsonResponse, tmdbPage, buildApp } = require('./helpers');

const completion = (obj) => jsonResponse({ choices: [{ message: { content: JSON.stringify(obj) } }] });

describe('OpenAI interpreter', () => {
  test('converts the model output into validated filters', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(completion({
      intent: 'recommend',
      kind: 'discover',
      genres: ['Comedy', 'Not A Genre'],
      year_from: 2020,
      sort_by: 'vote_average.desc',
      min_rating: 42
    }));
    const llm = createOpenAIInterpreter({ apiKey: 'sk-test', model: 'test-model', fetchImpl });

    const result = await llm.interpret('Suggest highly rated comedy movies from 2020 onwards.');

    expect(result).toEqual({
      intent: 'recommend',
      filters: expect.objectContaining({ genres: ['Comedy'], year_from: 2020, sort_by: 'vote_average.desc', min_rating: null })
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'test-model', response_format: { type: 'json_object' } });
  });

  test('throws on non-JSON model output so the caller can fall back', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'Sure! Here are some movies' } }] }));
    const llm = createOpenAIInterpreter({ apiKey: 'sk-test', model: 'm', fetchImpl });
    await expect(llm.interpret('comedy')).rejects.toThrow();
  });
});

describe('POST /api/chat with OPENAI_API_KEY set', () => {
  const isOpenAI = (url) => String(url).includes('openai.com');

  test('uses the OpenAI interpretation to query TMDB', async () => {
    const { app, fetchImpl } = buildApp({ OPENAI_API_KEY: 'sk-test' });
    fetchImpl.mockImplementation(async (url) => (isOpenAI(url)
      ? completion({ intent: 'recommend', kind: 'discover', genres: ['Horror'], sort_by: 'popularity.desc' })
      : jsonResponse(tmdbPage(2))));

    const res = await request(app).post('/api/chat').send({ message: 'something to keep me up at night' });

    expect(res.status).toBe(200);
    expect(res.body.interpreter).toBe('openai');
    expect(res.body.interpretation.genres).toEqual(['Horror']);
    expect(res.body.movies).toHaveLength(2);
  });

  test('falls back to rule-based parsing when OpenAI fails', async () => {
    const { app, fetchImpl } = buildApp({ OPENAI_API_KEY: 'sk-test' });
    fetchImpl.mockImplementation(async (url) => (isOpenAI(url) ? jsonResponse({ error: 'down' }, 503) : jsonResponse(tmdbPage(2))));

    const res = await request(app).post('/api/chat').send({ message: 'Recommend a thriller' });

    expect(res.status).toBe(200);
    expect(res.body.interpreter).toBe('rules');
    expect(res.body.interpretation.genres).toEqual(['Thriller']);
  });

  test('is optional: no key means rules only', () => {
    expect(loadConfig({}).openaiApiKey).toBeNull();
    expect(loadConfig({ OPENAI_API_KEY: 'your_openai_key' }).openaiApiKey).toBeNull();
  });
});

describe('config validation', () => {
  test('rejects an invalid PORT', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
  });
});
