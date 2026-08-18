const morgan = require("morgan");
const logger = require("./logger");
const { redact } = require("./userConfig");

morgan.token("safe-url", (req) => redact(req.originalUrl || req.url));

const HTTP_LOG_FORMAT =
  ":method :safe-url :status :res[content-length] - :response-time ms";

const writeToLogger = (message) => logger.http(message.trim());

const httpLogger = morgan(HTTP_LOG_FORMAT, {
  stream: { write: writeToLogger },
});

module.exports = { httpLogger, writeToLogger };
