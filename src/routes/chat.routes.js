const express = require('express');

function createChatRouter(controller) {
  const router = express.Router();
  router.post('/chat', controller.chat);
  router.get('/movies/:id', controller.movieDetails);
  return router;
}

module.exports = { createChatRouter };
