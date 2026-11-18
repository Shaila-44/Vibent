const { interpretRules } = require('../src/services/intent.service');

const filtersFor = (message) => interpretRules(message).filters;
const thisYear = new Date().getFullYear();

describe('rule-based intent extraction', () => {
  test.each([
    ['Recommend some psychological thrillers.', { genres: ['Thriller'], sort_by: 'popularity.desc' }],
    ['I want something light and funny.', { genres: ['Comedy'], mood: 'light' }],
    ['Suggest sci-fi movies released after 2015.', { genres: ['Science Fiction'], year_from: 2016, year_to: null }],
    ['Give me highly rated action movies.', { genres: ['Action'], sort_by: 'vote_average.desc' }],
    ['Suggest highly rated comedy movies from 2020 onwards.', { genres: ['Comedy'], year_from: 2020, sort_by: 'vote_average.desc' }],
    ['Best sci-fi movies', { genres: ['Science Fiction'], sort_by: 'vote_average.desc' }],
    ['Something funny', { genres: ['Comedy'] }],
    ['Recommend a thriller', { genres: ['Thriller'] }]
  ])('%s', (message, expected) => {
    expect(interpretRules(message).intent).toBe('recommend');
    expect(filtersFor(message)).toMatchObject({ kind: 'discover', ...expected });
  });

  test('mood-only requests map to several genres with OR matching', () => {
    expect(filtersFor("I'm bored. Suggest something interesting.")).toMatchObject({
      mood: 'bored',
      genre_match: 'any',
      sort_by: 'vote_average.desc',
      genres: expect.arrayContaining(['Mystery', 'Science Fiction'])
    });
  });

  test.each([
    ['romantic movies between 2000 and 2010', { year_from: 2000, year_to: 2010 }],
    ['horror from the 90s', { year_from: 1990, year_to: 1999 }],
    ['1980s action', { year_from: 1980, year_to: 1989 }],
    ['comedies before 2000', { year_to: 1999 }],
    ['dramas from 2019', { year_from: 2019 }],
    ['westerns 1970-1979', { year_from: 1970, year_to: 1979 }],
    ['thrillers in 2012', { year_from: 2012, year_to: 2012 }],
    ['recent sci-fi', { year_from: thisYear - 3 }]
  ])('years: %s', (message, expected) => {
    expect(filtersFor(message)).toMatchObject(expected);
  });

  test.each([
    ['action movies rated above 7', 7],
    ['comedies with a rating of at least 7.5', 7.5],
    ['8+ dramas', 8],
    ['thrillers 6.5/10 or higher', 6.5]
  ])('ratings: %s', (message, rating) => {
    expect(filtersFor(message).min_rating).toBe(rating);
  });

  test('years are not mistaken for ratings', () => {
    expect(filtersFor('action from 2020 onwards').min_rating).toBeNull();
  });

  test('"X or Y" uses OR matching; "X and Y" uses AND matching', () => {
    expect(filtersFor('horror or comedy')).toMatchObject({ genres: ['Comedy', 'Horror'], genre_match: 'any' });
    expect(filtersFor('action comedy')).toMatchObject({ genres: ['Action', 'Comedy'], genre_match: 'all' });
  });

  test('"movies like <title>" becomes a similar-title request', () => {
    expect(filtersFor('Movies like The Dark Knight?')).toMatchObject({ kind: 'similar', query: 'The Dark Knight' });
    expect(filtersFor('something similar to Parasite')).toMatchObject({ kind: 'similar', query: 'Parasite' });
  });

  test('"something like a comedy" is treated as a genre, not a title', () => {
    expect(filtersFor('something like a comedy')).toMatchObject({ kind: 'discover', genres: ['Comedy'] });
  });

  test('a bare title becomes a search', () => {
    expect(filtersFor('Inception')).toMatchObject({ kind: 'search', query: 'Inception' });
  });

  test('vague requests fall back to popular movies and say so', () => {
    const result = interpretRules('What should I watch tonight?');
    expect(result.fallback).toBe(true);
    expect(result.filters).toMatchObject({ kind: 'discover', genres: [], sort_by: 'popularity.desc' });
  });

  test.each([
    ['show me more', 'more'],
    ['More please!', 'more'],
    ['hello', 'help'],
    ['what can you do?', 'help'],
    ['thanks!', 'thanks'],
    ['recommend a book', 'unsupported'],
    ['any good video games?', 'unsupported'],
    ['help me find a horror movie', 'recommend'],
    ['great action movies', 'recommend']
  ])('intent: %s -> %s', (message, intent) => {
    expect(interpretRules(message).intent).toBe(intent);
  });
});
