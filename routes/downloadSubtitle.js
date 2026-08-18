const openSubtitles = require("../clients/openSubtitles");
const logger = require("../common/logger");

// OpenSubtitles sometimes answers with something other than a subtitle, so a
// timestamp line is required before anything is served as one.
const SRT_TIMESTAMP_PATTERN =
  /\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/;

const downloadSubtitle = async (req, res) => {
  const fileId = req.params?.fileId;
  const { username } = req.userConfig;

  const respondWithError = (err, description, status = 502) => {
    logger.error(err || new Error(description), {
      fileId,
      username,
      description,
    });
    // Never let a failed fetch be cached (by Cloudflare or anyone else) as if
    // it were a valid subtitle file.
    res.setHeader("Cache-Control", "no-store");
    res.status(status).send("Could not fetch the subtitle file.");
  };

  try {
    const session = await openSubtitles.login(req.userConfig);

    logger.info("Requesting subtitle download from OpenSubtitles.", {
      fileId,
      username,
    });

    const link = await openSubtitles.requestDownloadLink(fileId, session);
    const content = await openSubtitles.fetchSubtitleFile(link);

    if (!SRT_TIMESTAMP_PATTERN.test(content || "")) {
      respondWithError(null, "OpenSubtitles did not return a valid SRT file.");
      return;
    }

    logger.debug("Serving SRT file.", {
      fileId,
      username,
      bytes: Buffer.byteLength(content),
    });

    res.setHeader("Content-Type", "application/x-subrip; charset=utf-8");
    res.end(Buffer.from(content));
  } catch (err) {
    const status = err.response?.status;

    // A rejected login is worth forgetting, otherwise a stale session keeps
    // being reused until it expires on its own.
    if (status === 401) {
      openSubtitles.forgetSession(req.userConfig);
      respondWithError(err, "OpenSubtitles rejected the credentials.", 401);
      return;
    }

    if (status === 406) {
      respondWithError(err, "The daily download quota is used up.", 429);
      return;
    }

    respondWithError(err, "Error downloading the subtitle file.");
  }
};

module.exports = { downloadSubtitle };
