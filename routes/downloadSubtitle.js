const openSubtitles = require("../clients/openSubtitles");
const subtitleFileCache = require("../common/subtitleFileCache");
const downloadFailures = require("../common/downloadFailureCache");
const config = require("config");
const logger = require("../common/logger");

const MAX_AGE_SECONDS = Number(config.get("srtCacheMaxAgeSeconds"));

// OpenSubtitles sometimes answers with something other than a subtitle, so a
// timestamp line is required before anything is served as one.
const SRT_TIMESTAMP_PATTERN =
  /\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/;

// The reason travels on the error itself rather than in its wording, so that
// rewording the message cannot quietly send it down a different branch.
const invalidSrtError = () =>
  Object.assign(new Error("OpenSubtitles did not return a valid SRT file."), {
    code: "INVALID_SRT",
  });

const recentFailureError = (status) =>
  Object.assign(new Error("This download failed moments ago."), {
    code: "RECENT_FAILURE",
    status,
  });

const downloadSubtitle = async (req, res) => {
  const fileId = req.params?.fileId;
  const { username } = req.userConfig;

  // A subtitle's contents never change for a given file id, so the id itself is
  // a valid fingerprint. Setting it before anything else means a client that
  // already has the file gets a 304 without OpenSubtitles being asked at all.
  res.set("ETag", `"os-${fileId}"`);
  res.set("Cache-Control", `public, max-age=${MAX_AGE_SECONDS}`);

  if (req.fresh) {
    logger.debug("Subtitle already held by the client.", { fileId });
    res.status(304).end();
    return;
  }

  const sendError = (status) => {
    // Never let a failed fetch be cached (by Cloudflare or anyone else) as if
    // it were a valid subtitle file.
    res.setHeader("Cache-Control", "no-store");
    res.status(status).send("Could not fetch the subtitle file.");
  };

  const respondWithError = (err, description, status = 502) => {
    logger.error(err || new Error(description), {
      fileId,
      username,
      description,
    });
    // Remembered so the dozen retries Stremio is about to send do not each ask
    // OpenSubtitles the question it has just answered. Only the status is kept,
    // never a body.
    downloadFailures.remember(fileId, req.userConfig, status);
    sendError(status);
  };

  try {
    // Logging in first, before the cache is consulted, so a cached file cannot
    // be handed to someone whose credentials were never checked. The session is
    // itself cached, so this costs nothing on a repeat.
    const session = await openSubtitles.login(req.userConfig);

    const content = await subtitleFileCache.getOrFetch(fileId, async () => {
      // Consulted only once the file cache has missed, so a file that has since
      // been downloaded successfully is still served rather than refused for
      // the rest of the memory's life.
      const failedStatus = downloadFailures.recall(fileId, req.userConfig);
      if (failedStatus !== undefined) {
        throw recentFailureError(failedStatus);
      }

      logger.info("Requesting subtitle download from OpenSubtitles.", {
        fileId,
        username,
      });

      const link = await openSubtitles.requestDownloadLink(fileId, session);
      const fetched = await openSubtitles.fetchSubtitleFile(link);

      // Validated before it is cached, so one bad answer cannot become every
      // viewer's subtitle until it expires.
      if (!SRT_TIMESTAMP_PATTERN.test(fetched || "")) {
        throw invalidSrtError();
      }

      return fetched;
    });

    // Whatever failed before plainly works now, so the memory of it goes rather
    // than standing in the way of the next request that misses the file cache.
    downloadFailures.forget(fileId, req.userConfig);

    logger.debug("Serving SRT file.", {
      fileId,
      username,
      bytes: Buffer.byteLength(content),
    });

    res.setHeader("Content-Type", "application/x-subrip; charset=utf-8");
    res.send(Buffer.from(content));
  } catch (err) {
    const status = err.response?.status;

    // Answered from the memory of a failure seconds ago: nothing was asked of
    // OpenSubtitles, so there is nothing new to record and nothing to shout
    // about in the logs.
    if (err.code === "RECENT_FAILURE") {
      logger.debug("Refusing a download that just failed.", {
        fileId,
        username,
        status: err.status,
      });
      sendError(err.status);
      return;
    }

    // A rejected login is worth forgetting, otherwise a stale session keeps
    // being reused until it expires on its own.
    if (status === 401) {
      openSubtitles.forgetSession(req.userConfig);
      respondWithError(err, "OpenSubtitles rejected the credentials.", 401);
      return;
    }

    // An exhausted quota is a 406, not the 429 one would expect: their error
    // codes page lists the quota body under 406 and keeps 429 for the
    // per-second throttle, and their own Kodi addon splits the two the same
    // way. Written down because the only way to see it first hand is to spend
    // somebody's whole day of downloads.
    // https://opensubtitles.stoplight.io/docs/opensubtitles-api/12f131ce12132-error-codes
    if (status === 406) {
      respondWithError(err, "The daily download quota is used up.", 429);
      return;
    }

    if (err.code === "INVALID_SRT") {
      respondWithError(err, "OpenSubtitles did not return a valid SRT file.");
      return;
    }

    respondWithError(err, "Error downloading the subtitle file.");
  }
};

module.exports = { downloadSubtitle };
