const { validateChatBody } = require('../utils/validators');
const { badRequest } = require('../utils/errors');

function createChatController({ recommender, catalog }) {
  return {
    async chat(req, res) {
      const { message, context } = validateChatBody(req.body);
      res.json(await recommender.respond({ message, context }));
    },

    async movieDetails(req, res) {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0 || id > 1e9) throw badRequest('Movie id must be a positive integer.');
      res.json({ success: true, source: catalog.source, movie: await catalog.details(id) });
    }
  };
}

module.exports = { createChatController };
