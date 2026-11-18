/**
 * DEMO MODE ONLY — used when no TMDB_API_KEY is configured.
 *
 * A small catalogue of fictional sample titles so the chat UI can be tried
 * without credentials. These are NOT real movies and NOT TMDB data; every API
 * response produced from here is marked `source: "demo"` and the UI labels it.
 * It implements the same interface as tmdb.service.js.
 */
const { GENRES, ID_TO_NAME } = require('./genres');
const { AppError } = require('../utils/errors');

const PAGE_SIZE = 20;

const g = (...names) => names.map((n) => GENRES[n]);

const SAMPLES = [
  ['Signal From Halcyon', 2019, 7.9, g('Science Fiction', 'Thriller'), 'A radio astronomer decodes a message that seems to predict her own decisions.'],
  ['The Long Orbit', 2021, 7.4, g('Science Fiction', 'Drama'), 'Two engineers on a slow cargo ship discover they are not alone on board.'],
  ['Paper Moons', 2017, 7.1, g('Science Fiction', 'Adventure'), 'Kids build a rocket from scrap and accidentally launch it.'],
  ['Neon Cartographer', 2023, 6.8, g('Science Fiction', 'Action'), 'A mapmaker in a sprawling megacity charts streets that move overnight.'],
  ['Quiet Hours', 2016, 7.7, g('Thriller', 'Mystery'), 'A night-shift nurse notices a patient who never seems to age.'],
  ['The Glass Witness', 2020, 7.3, g('Thriller', 'Crime'), 'A juror starts receiving letters from someone inside the deliberation room.'],
  ['Undertow', 2014, 6.9, g('Thriller', 'Drama'), 'A psychologist suspects her new client is describing her own past.'],
  ['Second Floor Left', 2022, 7.5, g('Mystery', 'Thriller'), 'Neighbours in a quiet building each claim the empty flat is occupied.'],
  ['Totally Normal Wedding', 2021, 6.6, g('Comedy', 'Romance'), 'Everything that can go wrong at a wedding does, in alphabetical order.'],
  ['The Accidental Chef', 2018, 6.9, g('Comedy', 'Family'), 'A hapless dad bluffs his way into a televised cooking contest.'],
  ['Office Llama', 2023, 6.4, g('Comedy'), 'A tech startup adopts a llama as its chief morale officer.'],
  ['Sunny Side Up', 2015, 7.2, g('Comedy', 'Drama'), 'A retired comedian teaches stand-up at a small-town diner.'],
  ['Pocket Dragon', 2020, 7.6, g('Animation', 'Family', 'Fantasy'), 'A shy girl finds a dragon small enough to live in her backpack.'],
  ['Clockwork Garden', 2017, 7.8, g('Animation', 'Fantasy'), 'A gardener robot tends the last greenhouse on Earth.'],
  ['Iron Meridian', 2019, 6.7, g('Action', 'Adventure'), 'A courier races across three borders with a package she must not open.'],
  ['Redline Protocol', 2022, 6.5, g('Action', 'Thriller'), 'An ex-pilot is pulled back for one impossible extraction.'],
  ['The Last Lantern', 2012, 7.4, g('Adventure', 'Fantasy'), 'Two siblings follow a map that redraws itself every dawn.'],
  ['Hollow Pines', 2018, 6.8, g('Horror', 'Mystery'), 'A summer camp reopens twenty years after it was abandoned.'],
  ['Static Room', 2021, 6.3, g('Horror'), 'A podcast crew records something in an empty studio.'],
  ['Letters to Lisbon', 2013, 7.3, g('Romance', 'Drama'), 'Strangers fall in love through letters left in a library book.'],
  ['The Harbour Year', 1998, 8.1, g('Drama', 'History'), 'A fishing town weathers the year its harbour closes.'],
  ['Dust and Thunder', 1972, 7.9, g('Western'), 'A retired sheriff rides out one last time to settle a debt.'],
  ['Blue Note Avenue', 1994, 7.6, g('Music', 'Drama'), 'A jazz pianist rebuilds her band after a fire.'],
  ['Night Train to Varna', 1987, 7.7, g('Crime', 'Mystery'), 'A detective has one overnight journey to find a missing diplomat.'],
  ['The Frost Line', 2010, 7.0, g('War', 'Drama'), 'A small unit holds a mountain pass through a brutal winter.'],
  ['Wild Kingdom Below', 2016, 8.0, g('Documentary'), 'A look at the ecosystems living beneath city streets.']
].map(([title, year, rating, genreIds, overview], i) => ({
  id: 900001 + i,
  title,
  overview,
  release_date: `${year}-06-01`,
  rating,
  vote_count: 1000 - i * 20,
  poster_path: null,
  poster_url: null,
  genres: genreIds.map((id) => ID_TO_NAME[id]),
  tmdb_url: null,
  popularity: 100 - ((i * 37) % 100)
}));

function paginate(list, page) {
  const start = (page - 1) * PAGE_SIZE;
  return {
    results: list.slice(start, start + PAGE_SIZE).map(({ popularity, ...movie }) => movie),
    page,
    total_pages: Math.ceil(list.length / PAGE_SIZE)
  };
}

function matchesFilters(movie, filters) {
  const year = Number(movie.release_date.slice(0, 4));
  if (filters.genres.length) {
    const has = (name) => movie.genres.includes(name);
    const ok = filters.genre_match === 'any' ? filters.genres.some(has) : filters.genres.every(has);
    if (!ok) return false;
  }
  if (filters.year_from && year < filters.year_from) return false;
  if (filters.year_to && year > filters.year_to) return false;
  if (filters.min_rating && movie.rating < filters.min_rating) return false;
  return true;
}

function createDemoClient() {
  return {
    source: 'demo',

    async discover(filters, page = 1) {
      const sorted = SAMPLES.filter((m) => matchesFilters(m, filters)).sort((a, b) =>
        filters.sort_by === 'vote_average.desc' ? b.rating - a.rating : b.popularity - a.popularity);
      return paginate(sorted, page);
    },

    async search(query, page = 1) {
      const q = query.toLowerCase();
      return paginate(SAMPLES.filter((m) => m.title.toLowerCase().includes(q)), page);
    },

    async similar(title, page = 1) {
      const base = SAMPLES.find((m) => m.title.toLowerCase().includes(title.toLowerCase()));
      if (!base) return { results: [], page: 1, total_pages: 0, basedOn: null };
      const related = SAMPLES.filter((m) => m !== base && m.genres.some((x) => base.genres.includes(x)));
      const { popularity, ...basedOn } = base;
      return { ...paginate(related, page), basedOn };
    },

    async details(id) {
      const movie = SAMPLES.find((m) => m.id === id);
      if (!movie) throw new AppError(404, 'NOT_FOUND', "I couldn't find that movie.");
      const { popularity, ...rest } = movie;
      return { ...rest, runtime: 100 + (id % 30), tagline: 'Sample title for demo mode.' };
    }
  };
}

module.exports = { createDemoClient, SAMPLES };
