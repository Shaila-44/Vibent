/**
 * Optional LLM interpreter. When OPENAI_API_KEY is set, the user's message is
 * sent to the Chat Completions API and converted into the same structured
 * filters the rule-based interpreter produces. The model's output is treated
 * as untrusted: it is validated by normalizeFilters before use, and any
 * failure makes the caller fall back to rules.
 *
 * The model never writes the reply text or invents movies — it only chooses
 * search parameters; the movies always come from TMDB.
 */
const { normalizeFilters } = require('../utils/validators');
const { GENRE_NAMES } = require('./genres');

const API_URL = 'https://api.openai.com/v1/chat/completions';
const INTENTS = ['recommend', 'help', 'thanks', 'unsupported', 'more'];

function systemPrompt() {
  return [
    'You convert messages sent to a movie recommendation chatbot into JSON search parameters.',
    'Reply with a single JSON object and nothing else, using exactly these keys:',
    '{"intent": "recommend" | "help" | "thanks" | "unsupported" | "more",',
    ' "kind": "discover" | "search" | "similar",',
    ' "query": string or null,',
    ' "genres": string[],',
    ' "genre_match": "all" | "any",',
    ' "year_from": integer or null, "year_to": integer or null,',
    ' "min_rating": number 0-10 or null,',
    ' "sort_by": "popularity.desc" | "vote_average.desc",',
    ' "mood": short lowercase word or null,',
    ' "topic": string or null}',
    `Allowed genres: ${GENRE_NAMES.join(', ')}.`,
    `The current year is ${new Date().getFullYear()}.`,
    'Rules:',
    '- kind "discover" filters by genre/year/rating. kind "search" looks up a specific title given in "query". kind "similar" means "movies like <title>"; put the title in "query".',
    '- For moods (bored, sad, want something light), pick 2-3 fitting genres with genre_match "any".',
    '- "after 2015" means year_from 2016; "from 2020 onwards" means year_from 2020; "90s" means 1990-1999.',
    '- Use sort_by "vote_average.desc" for "best", "highly rated", "acclaimed" or "classic"; otherwise "popularity.desc".',
    '- Greetings or questions about what you can do: intent "help". Thanks: intent "thanks".',
    '- Requests for books, games, music, TV or anything other than movies: intent "unsupported" with "topic" set.',
    '- "more" / "show me more": intent "more".'
  ].join('\n');
}

function createOpenAIInterpreter({ apiKey, model, timeoutMs = 10000, fetchImpl = (...a) => fetch(...a) }) {
  return {
    name: 'openai',

    async interpret(message) {
      const res = await fetchImpl(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 200,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt() },
            { role: 'user', content: message }
          ]
        })
      });
      if (!res.ok) throw new Error(`OpenAI responded ${res.status}`);

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('OpenAI response had no content');

      const parsed = JSON.parse(content);
      const intent = INTENTS.includes(parsed.intent) ? parsed.intent : 'recommend';
      if (intent !== 'recommend') {
        return { intent, topic: typeof parsed.topic === 'string' ? parsed.topic.slice(0, 40) : null };
      }
      const filters = normalizeFilters(parsed);
      if (!filters) throw new Error('OpenAI returned unusable filters');
      return { intent, filters };
    }
  };
}

module.exports = { createOpenAIInterpreter, systemPrompt };
