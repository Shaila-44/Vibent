/**
 * TMDB movie genre IDs (stable values from GET /genre/movie/list).
 * Kept static to avoid an extra API call on every request.
 */
const GENRES = {
  Action: 28,
  Adventure: 12,
  Animation: 16,
  Comedy: 35,
  Crime: 80,
  Documentary: 99,
  Drama: 18,
  Family: 10751,
  Fantasy: 14,
  History: 36,
  Horror: 27,
  Music: 10402,
  Mystery: 9648,
  Romance: 10749,
  'Science Fiction': 878,
  Thriller: 53,
  War: 10752,
  Western: 37
};

const GENRE_NAMES = Object.keys(GENRES);
const ID_TO_NAME = Object.fromEntries(Object.entries(GENRES).map(([name, id]) => [id, name]));

/** Case-insensitive lookup that also accepts a few common aliases. */
function canonicalGenre(name) {
  if (typeof name !== 'string') return null;
  const lower = name.trim().toLowerCase();
  if (['sci-fi', 'scifi', 'sci fi'].includes(lower)) return 'Science Fiction';
  return GENRE_NAMES.find((g) => g.toLowerCase() === lower) || null;
}

module.exports = { GENRES, GENRE_NAMES, ID_TO_NAME, canonicalGenre };
