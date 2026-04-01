const serverless = require('serverless-http');
const app = require('../../server'); // Ensure server.js exports the app

module.exports.handler = serverless(app);
