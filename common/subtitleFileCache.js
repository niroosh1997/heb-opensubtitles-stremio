const { LRUCache } = require("lru-cache");
const config = require("config");
const logger = require("./logger");

// Bounded by memory rather than by count: subtitle files vary from a few
// kilobytes to a couple of hundred, so a count would either waste space or
// blow past it.
const cache = new LRUCache({
  maxSize: Number(config.get("subtitleFileCache.maxBytes")),
  ttl: Number(config.get("subtitleFileCache.ttlMs")),
  sizeCalculation: (value) =>
    typeof value === "string" ? Buffer.byteLength(value) : 1,
});

// A file id addresses one immutable file, so it is the whole key. The contents
// are the same whoever asked for them, which is why one entry serves everyone.
// Callers are still authenticated before they get here.
const getOrFetch = async (fileId, fetchSubtitle) => {
  const cached = cache.get(fileId);

  if (cached) {
    logger.debug("Subtitle file cache hit.", { fileId });
    return cached;
  }

  logger.debug("Subtitle file cache miss.", { fileId });

  // The pending promise is cached, not just its result, so the burst of
  // requests Stremio makes for one subtitle share a single download instead of
  // starting one each.
  const pending = fetchSubtitle();
  cache.set(fileId, pending, { size: 1 });

  try {
    const content = await pending;
    cache.set(fileId, content);
    return content;
  } catch (err) {
    // Never keep a failure, or one bad answer from OpenSubtitles becomes every
    // viewer's subtitle until it expires.
    cache.delete(fileId);
    throw err;
  }
};

module.exports = { getOrFetch };
