const { LRUCache } = require("lru-cache");
const crypto = require("crypto");
const config = require("config");
const logger = require("./logger");

// Stremio asks for a failed subtitle around sixteen times in three seconds, and
// the file cache deliberately keeps no failed download, so one tap on a subtitle
// OpenSubtitles cannot serve spends sixteen calls learning the same thing.
const failures = new LRUCache({
  max: Number(config.get("downloadFailureCache.maxEntries")),
  ttl: Number(config.get("downloadFailureCache.ttlMs")),
});

// Keyed on the credentials as well as the file id. A used up quota belongs to
// one account, so a key of the file id alone would let the first user to run
// out block that subtitle for everyone else. The password is in the key too,
// since a 401 for a mistyped password must not fail the same username's real
// requests, and the key is hashed the way the session cache hashes its own so
// that a password is not held in memory.
const keyFor = (fileId, { username, password }) =>
  crypto
    .createHash("sha256")
    .update(`${fileId}:${username}:${password}`)
    .digest("hex");

// Only the status that was served is kept, never a body. A body cached is a
// body served, which is the reason the file cache refuses to keep failures at
// all; the fact that it failed is safe to keep and is all this needs.
const remember = (fileId, credentials, status) => {
  logger.debug("Remembering a failed download.", { fileId, status });
  failures.set(keyFor(fileId, credentials), status);
};

const recall = (fileId, credentials) =>
  failures.get(keyFor(fileId, credentials));

const forget = (fileId, credentials) =>
  failures.delete(keyFor(fileId, credentials));

module.exports = { remember, recall, forget };
