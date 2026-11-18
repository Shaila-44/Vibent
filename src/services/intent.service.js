/**
 * Rule-based interpretation of chat messages into TMDB search filters.
 *
 * This is deliberately simple keyword/regex matching — not an AI model. When an
 * OpenAI key is configured, openai.service.js is tried first and this module
 * is the fallback.
 */
const { normalizeFilters } = require('../utils/validators');

const YEAR = '(18[7-9]\\d|19\\d{2}|20\\d{2})';

const GENRE_PATTERNS = [
  ['Science Fiction', /\b(sci[- ]?fi|science[- ]fiction|space|futuristic|cyberpunk|dystopian|dystopia|aliens?|time[- ]travel|robots?)\b/],
  ['Action', /\b(action|action[- ]packed|martial arts|explosions?|superheroe?s?)\b/],
  ['Adventure', /\b(adventures?|quests?)\b/],
  ['Animation', /\b(animation|animated|cartoons?|anime|pixar)\b/],
  ['Comedy', /\b(comedy|comedies|funny|hilarious|laugh|laughs|laughing|humou?r|humorous|rom[- ]?coms?|silly|goofy)\b/],
  ['Crime', /\b(crime|heists?|gangsters?|mafia)\b/],
  ['Documentary', /\b(documentary|documentaries|docs?)\b/],
  ['Drama', /\b(dramas?|dramatic)\b/],
  ['Family', /\b(family|kids|children|kid[- ]friendly|family[- ]friendly)\b/],
  ['Fantasy', /\b(fantasy|magic|magical|wizards?|dragons?|fairy[- ]tales?)\b/],
  ['History', /\b(history|historical|period (?:piece|drama)s?)\b/],
  ['Horror', /\b(horror|scary|terrifying|spooky|creepy|slashers?|frightening)\b/],
  ['Music', /\b(musicals?|music)\b/],
  ['Mystery', /\b(mystery|mysteries|whodunn?its?|detectives?)\b/],
  ['Romance', /\b(romance|romantic|love stor(?:y|ies)|rom[- ]?coms?|date night)\b/],
  ['Thriller', /\b(thrillers?|suspense|suspenseful|psychological|tense)\b/],
  ['War', /\b(war|wwii|ww2|military)\b/],
  ['Western', /\b(westerns?|cowboys?)\b/]
];

// Moods supply genres only when the user didn't name one explicitly.
const MOODS = [
  {
    mood: 'bored',
    pattern: /\b(bored|interesting|surprise me|random|kill (?:some )?time|(?:don'?t|do not) know what to watch|no idea what to watch)\b/,
    genres: ['Mystery', 'Science Fiction', 'Adventure', 'Thriller'],
    sort: 'vote_average.desc'
  },
  {
    mood: 'mind-bending',
    pattern: /\b(mind[- ]?bending|mind[- ]?blowing|twisty|plot twists?|make me think|thought[- ]provoking|cerebral)\b/,
    genres: ['Science Fiction', 'Mystery', 'Thriller'],
    sort: 'vote_average.desc'
  },
  {
    mood: 'light',
    pattern: /\b(light|lighthearted|light-hearted|feel[- ]good|cheer me up|uplifting|happy|cheerful|wholesome|chill|relax|relaxing|cozy|cosy|easy watch|fun)\b/,
    genres: ['Comedy', 'Family', 'Animation']
  },
  {
    mood: 'exciting',
    pattern: /\b(exciting|adrenaline|pumped|intense|thrilling|edge of (?:my|the) seat)\b/,
    genres: ['Action', 'Thriller', 'Adventure']
  },
  {
    mood: 'emotional',
    pattern: /\b(sad|cry|crying|tear-?jerkers?|emotional|heartbreaking|moving)\b/,
    genres: ['Drama']
  }
];

const RATING_CUE = /\b(highly[- ]rated|high[- ]rated|top[- ]rated|best|greatest|acclaimed|critically|masterpieces?|must[- ](?:see|watch)|award[- ]winning|oscar[- ]winning)\b/;
const POPULAR_CUE = /\b(popular|trending|blockbusters?|hits?|mainstream)\b/;
const CLASSIC_CUE = /\b(classic|classics|old|older|oldies|vintage)\b/;
const RECENT_CUE = /\b(recent|recently|new|newer|newest|latest|modern)\b/;

const MORE = /^(?:please\s+)?(?:(?:show|give|get)\s+)?(?:me\s+)?(?:some\s+)?(?:more|others|next|another (?:batch|set|few))(?:\s+(?:ones|movies|films|results|options|suggestions|picks|please|like (?:these|those|that|this)))*\s*[.!?]*$/;
const THANKS = /^(?:thanks|thank you|thx|ty|cheers)\b[\s\w,]{0,20}[.!]*$/;
const GREETING = /^(?:hi|hello|hey|yo|hiya|howdy|good (?:morning|afternoon|evening))\b[\s!.,]*(?:there|vibent)?[\s!.]*$/;
const HELP = /\b(help|what can you do|how does this work|who are you|what are you)\b/;
const MOVIE_WORD = /\b(movies?|films?|flicks?|cinema)\b/;
const UNSUPPORTED = /\b(books?|novels?|video ?games?|games?|songs?|albums?|playlists?|podcasts?|restaurants?|food|recipes?|tv shows?|series|events?|concerts?|flights?|hotels?|trips?)\b/;
const SIMILAR = /\b(?:movies?|films?|something|anything|stuff|ones?)\s+(?:like|similar to)\s+(.+)$|\b(?:similar to|in the vein of)\s+(.+)$/i;

const FILLER = new Set(('recommend recommendation recommendations suggest suggestion suggestions give show find me some a an the any ' +
  'movie movies film films flick flicks please pls i im i\'m want wanna would like to watch something anything good great what ' +
  'should can you could tonight today now for of with and or see need looking idea ideas options lets let\'s get pick picks ' +
  'choose my us we our is are there maybe few couple list cool nice okay ok so just really very much about tell kind type sort ' +
  'on in it that this be have do does'
).split(' '));

function currentYear() {
  return new Date().getFullYear();
}

function extractYears(text) {
  let m;
  if ((m = text.match(new RegExp(`\\b(?:between\\s+|from\\s+)?${YEAR}\\s*(?:-|–|to|and|until|through|thru)\\s*${YEAR}\\b`)))) {
    return { year_from: +m[1], year_to: +m[2] };
  }
  if ((m = text.match(new RegExp(`\\b(?:after|post|later than|newer than)\\s+${YEAR}\\b`)))) {
    return { year_from: +m[1] + 1 };
  }
  if ((m = text.match(new RegExp(`\\b(?:since|from|starting(?:\\s+(?:in|from))?)\\s+${YEAR}\\b`))) ||
      (m = text.match(new RegExp(`\\b${YEAR}\\s*(?:\\+|onwards?\\b|and (?:later|after|up|beyond|newer)\\b|or (?:later|newer|after)\\b)`)))) {
    return { year_from: +m[1] };
  }
  if ((m = text.match(new RegExp(`\\b(?:before|pre|prior to|earlier than|older than)[\\s-]*${YEAR}\\b`)))) {
    return { year_to: +m[1] - 1 };
  }
  if ((m = text.match(new RegExp(`\\b(?:until|up to|through|thru)\\s+${YEAR}\\b`)))) {
    return { year_to: +m[1] };
  }
  if ((m = text.match(/\b(18|19|20)?(\d)0'?s\b/))) {
    const start = m[1] ? +`${m[1]}${m[2]}0` : (+m[2] >= 3 ? 1900 : 2000) + +m[2] * 10;
    return { year_from: start, year_to: start + 9 };
  }
  if (/\bthis year\b/.test(text)) return { year_from: currentYear(), year_to: currentYear() };
  if (/\blast year\b/.test(text)) return { year_from: currentYear() - 1, year_to: currentYear() - 1 };
  if ((m = text.match(new RegExp(`\\b${YEAR}\\b`)))) {
    return { year_from: +m[1], year_to: +m[1] };
  }
  if (RECENT_CUE.test(text)) return { year_from: currentYear() - 3 };
  if (CLASSIC_CUE.test(text)) return { year_to: 1989 };
  return {};
}

function extractMinRating(text) {
  const patterns = [
    /\b(?:rated|rating|score|scored)\s*(?:of\s*)?(?:above|over|at least|more than|higher than|>=?)?\s*(\d(?:\.\d)?)(?![\d.])/,
    /\b(?:above|over|at least|more than|higher than)\s*(\d(?:\.\d)?)(?![\d.])\s*(?:\/\s*10|\+|stars?|rating|rated)/,
    /(?<![\d.])(\d(?:\.\d)?)\s*(?:\+|\/\s*10)/
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m && +m[1] > 0 && +m[1] <= 10) return +m[1];
  }
  return null;
}

function extractGenres(text) {
  return GENRE_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function cleanTitle(raw) {
  return raw
    .replace(/[?!.]+$/, '')
    .replace(/\b(?:movies?|films?)\s*$/i, '')
    .replace(/^["'“‘]|["'”’]$/g, '')
    .replace(/^(?:the movie|the film)\s+/i, '')
    .trim();
}

function leftoverSearchTerms(message) {
  const words = message
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((w) => w && !FILLER.has(w.toLowerCase()));
  return words.length >= 1 && words.length <= 6 ? words.join(' ') : null;
}

/**
 * @returns {{ intent: 'recommend'|'more'|'help'|'thanks'|'unsupported', filters?: object, topic?: string }}
 */
function interpretRules(message) {
  const original = message.trim();
  const text = original.toLowerCase().replace(/[’‘]/g, "'");

  if (MORE.test(text)) return { intent: 'more' };
  if (THANKS.test(text)) return { intent: 'thanks' };
  if (GREETING.test(text)) return { intent: 'help' };

  const unsupported = text.match(UNSUPPORTED);
  if (unsupported && !MOVIE_WORD.test(text)) return { intent: 'unsupported', topic: unsupported[1] };

  // "movies like Inception" -> recommendations based on a specific title.
  const similar = original.match(SIMILAR);
  let rest = text;
  if (similar) {
    const title = cleanTitle(similar[1] || similar[2]);
    const titleLower = title.toLowerCase().replace(/^(?:a|an|the)\s+/, '');
    rest = text.slice(0, similar.index);
    if (title && !extractGenres(titleLower).length && !MOODS.some((m) => m.pattern.test(titleLower))) {
      return { intent: 'recommend', filters: normalizeFilters({ kind: 'similar', query: title }) };
    }
    rest = text; // the "title" was really a genre/mood ("something like a comedy")
  }

  const genres = extractGenres(rest);
  const mood = MOODS.find((m) => m.pattern.test(rest)) || null;
  const years = extractYears(rest);
  const minRating = extractMinRating(rest);
  const wantsRating = RATING_CUE.test(rest) || CLASSIC_CUE.test(rest);
  const wantsPopular = POPULAR_CUE.test(rest);

  const hasCue = genres.length || mood || Object.keys(years).length || minRating || wantsRating || wantsPopular;

  if (!hasCue && HELP.test(text) && !MOVIE_WORD.test(text)) return { intent: 'help' };
  if (!hasCue) {
    const terms = leftoverSearchTerms(original);
    if (terms) return { intent: 'recommend', filters: normalizeFilters({ kind: 'search', query: terms }) };
  }

  const useMoodGenres = !genres.length && mood;
  return {
    intent: 'recommend',
    fallback: !hasCue,
    filters: normalizeFilters({
      kind: 'discover',
      genres: useMoodGenres ? mood.genres : genres,
      genre_match: useMoodGenres || /\bor\b/.test(rest) ? 'any' : 'all',
      ...years,
      min_rating: minRating,
      sort_by: wantsRating || (useMoodGenres && mood.sort) ? 'vote_average.desc' : 'popularity.desc',
      mood: mood ? mood.mood : null
    })
  };
}

module.exports = { interpretRules, MORE };
