const { createLogger, format, transports } = require("winston");
const config = require("config");

// Axios hangs its request and socket objects off the errors it throws, and
// winston merges those into the metadata, so a plain JSON.stringify throws on
// the circular reference and takes the process down with it. Logging must never
// be able to do that.
const safeStringify = (meta) => {
  const seen = new WeakSet();

  try {
    return JSON.stringify(meta, (key, value) => {
      if (typeof value !== "object" || value === null) {
        return value;
      }
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
      return value;
    });
  } catch (err) {
    return `[unserialisable meta: ${err.message}]`;
  }
};

const customFormat = format.printf((info) => {
  const { level, message, timestamp, stack, ...meta } = info;
  const metaString = Object.keys(meta).length ? safeStringify(meta) : "";
  return `${timestamp} [${level}]: ${stack || message} ${metaString}`;
});

const logger = createLogger({
  level: config.get("logLevel"),
  format: format.combine(
    format.timestamp({
      format: "DD-MM-YYYY HH:mm:ss",
    }),
    format.errors({ stack: true }),
    format.splat()
  ),
  transports: [
    new transports.Console({
      format: customFormat,
    }),
  ],
});

module.exports = logger;
