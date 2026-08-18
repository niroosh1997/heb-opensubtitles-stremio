const openSubtitles = require("../clients/openSubtitles");
const logger = require("../common/logger");

// Checks a username and password against OpenSubtitles before the configure
// page hands out an install link, so a typo is caught there rather than
// surfacing later as subtitles that list and never load.
const verifyCredentials = async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    res.status(400).send({ ok: false, error: "Fill in both fields." });
    return;
  }

  try {
    const session = await openSubtitles.login({ username, password });

    logger.info("Verified OpenSubtitles credentials.", { username });
    res.send({
      ok: true,
      allowedDownloads: session.allowedDownloads,
      vip: session.vip,
    });
  } catch (err) {
    const status = err.response?.status;

    if (status === 401) {
      res.status(401).send({
        ok: false,
        error: "OpenSubtitles did not accept that username and password.",
      });
      return;
    }

    logger.error(err, {
      username,
      description: "Could not verify credentials with OpenSubtitles",
    });
    res.status(502).send({
      ok: false,
      error: "Could not reach OpenSubtitles. Try again in a moment.",
    });
  }
};

module.exports = { verifyCredentials };
