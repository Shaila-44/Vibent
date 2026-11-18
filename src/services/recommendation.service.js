/**
 * Turns one chat message into a chatbot reply:
 *   interpret (OpenAI if configured, else rules) -> query the catalog
 *   (TMDB, or demo data) -> build a reply message around the real results.
 *
 * Reply text is generated from templates using the filters and the returned
 * movies, so the bot never describes movies it didn't actually retrieve.
 */
const { interpretRules } = require('./intent.service');
const logger = require('../utils/logger');

const PER_REPLY = 8;

const SUGGESTIONS = [
  'Recommend a thriller',
  'Something funny',
  'Best sci-fi movies',
  'Highly rated action movies'
];

const MOOD_OPENERS = {
  bored: 'Boredom, meet cure. ',
  light: 'Keeping it light. ',
  'mind-bending': 'Prepare to think. ',
  exciting: 'Buckle up. ',
  emotional: 'Tissues ready? '
};

const GENRE_LABEL = { 'Science Fiction': 'sci-fi' };

function joinList(items, conjunction) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`;
}

/** "highly rated sci-fi movies released 2016 or later" */
function describe(filters) {
  const parts = [];
  if (filters.sort_by === 'vote_average.desc') parts.push('highly rated');
  const genres = filters.genres.map((g) => GENRE_LABEL[g] || g.toLowerCase());
  if (genres.length) parts.push(joinList(genres, filters.genre_match === 'any' ? 'or' : 'and'));
  parts.push('movies');

  const { year_from: from, year_to: to } = filters;
  if (from && to) parts.push(from === to ? `from ${from}` : `from ${from}–${to}`);
  else if (from) parts.push(`released ${from} or later`);
  else if (to) parts.push(`released up to ${to}`);

  if (filters.min_rating) parts.push(`rated ${filters.min_rating}+`);
  return parts.join(' ');
}

function yearOf(movie) {
  return movie?.release_date ? movie.release_date.slice(0, 4) : '';
}

function createRecommender({ catalog, llm = null }) {
  async function interpret(message) {
    const rules = interpretRules(message);
    // Follow-up paging is handled by rules; no need to spend an LLM call on "more".
    if (!llm || rules.intent === 'more') return { ...rules, interpreter: 'rules' };
    try {
      return { ...(await llm.interpret(message)), interpreter: llm.name };
    } catch (err) {
      logger.warn(`LLM interpretation failed, using rules instead: ${err.message}`);
      return { ...rules, interpreter: 'rules', llmFailed: true };
    }
  }

  async function fetchPage(filters, page) {
    if (filters.kind === 'search') return catalog.search(filters.query, page);
    if (filters.kind === 'similar') return catalog.similar(filters.query, page);
    return catalog.discover(filters, page);
  }

  function replyText({ filters, movies, basedOn, isMore, fallback }) {
    if (isMore) {
      return movies.length ? 'Here are a few more.' : "That's everything I have for that request. Try asking for something new!";
    }
    if (filters.kind === 'search') {
      return movies.length
        ? `Here's what I found for "${filters.query}".`
        : `I couldn't find any movies matching "${filters.query}". Try a genre, a mood, or a different title.`;
    }
    if (filters.kind === 'similar') {
      if (!basedOn) return `I couldn't find a movie called "${filters.query}". Check the spelling or try another title.`;
      const label = `${basedOn.title}${yearOf(basedOn) ? ` (${yearOf(basedOn)})` : ''}`;
      return movies.length
        ? `If you liked ${label}, you might enjoy these.`
        : `I found ${label}, but TMDB has no recommendations for it yet. Try another title.`;
    }
    if (fallback) {
      return "I wasn't sure exactly what you're after, so here are some popular movies. Try naming a genre, a mood, or a year.";
    }
    if (!movies.length) {
      return `I couldn't find any ${describe(filters)}. Try widening the year range or dropping a filter.`;
    }
    return `${MOOD_OPENERS[filters.mood] || ''}Here are some ${describe(filters)} you might enjoy.`;
  }

  async function recommend(filters, page, offset, extras = {}) {
    const data = await fetchPage(filters, page);
    const movies = data.results.slice(offset, offset + PER_REPLY);

    let next = null;
    if (offset + PER_REPLY < data.results.length) next = { filters, page, offset: offset + PER_REPLY };
    else if (data.page < data.total_pages) next = { filters, page: page + 1, offset: 0 };

    return {
      message: replyText({ filters, movies, basedOn: data.basedOn, ...extras }),
      movies,
      next,
      suggestions: movies.length ? [] : SUGGESTIONS
    };
  }

  return {
    async respond({ message, context }) {
      const interpretation = await interpret(message);
      const base = {
        success: true,
        source: catalog.source,
        interpreter: interpretation.interpreter,
        movies: [],
        interpretation: null,
        next: null,
        suggestions: []
      };

      switch (interpretation.intent) {
        case 'help':
          return {
            ...base,
            message: "I'm VIBENT, a movie recommendation bot. Tell me a genre, a mood, a year range or a movie you liked, and I'll find something to watch.",
            suggestions: SUGGESTIONS
          };
        case 'thanks':
          return { ...base, message: "You're welcome! Ask me anytime you need something to watch." };
        case 'unsupported':
          return {
            ...base,
            message: `I can only recommend movies for now${interpretation.topic ? `, not ${interpretation.topic}` : ''}. Want a movie suggestion instead?`,
            suggestions: SUGGESTIONS
          };
        case 'more': {
          if (!context) {
            return { ...base, message: 'Ask me for some movies first, then I can show you more.', suggestions: SUGGESTIONS };
          }
          const result = await recommend(context.filters, context.page, context.offset, { isMore: true });
          return { ...base, ...result, interpretation: context.filters };
        }
        default: {
          const { filters } = interpretation;
          const result = await recommend(filters, 1, 0, { fallback: interpretation.fallback });
          return { ...base, ...result, interpretation: filters };
        }
      }
    }
  };
}

module.exports = { createRecommender, describe, PER_REPLY, SUGGESTIONS };
