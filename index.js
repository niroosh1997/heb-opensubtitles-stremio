require("dotenv").config();
const logger = require("./common/logger");
const { httpLogger } = require("./common/httpLogger");
const { decode } = require("./common/userConfig");
const config = require("config");
const express = require("express");
const cors = require("cors");
const { serveManifest } = require("./routes/manifest");
const landing = require("./routes/landing/landing");
const {
  extractTitleInfo,
  fetchSubsMiddleware,
  formatSubs,
} = require("./routes/subs");
const { downloadSubtitle } = require("./routes/downloadSubtitle");
const { verifyCredentials } = require("./routes/verify");

const PORT = config.get("PORT");
const HTTP = config.get("ssl") ? "https" : "http";
const HOSTNAME = config.get("HOSTNAME");

const addon = express();
addon.use(cors());
addon.use(httpLogger);
// Only the verify endpoint takes a body, and it is small.
addon.use(express.json({ limit: "1kb" }));

const respondWithHeaders = function (req, res, next) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Content-Type", "application/json");
  next();
};

// The user's OpenSubtitles credentials travel in the first path segment, which
// is what keeps the addon stateless. It never reaches a log: httpLogger
// replaces the segment before the line is written.
const extractUserConfig = (req, res, next) => {
  try {
    req.userConfig = decode(req.params.userConfig);
    next();
  } catch (err) {
    logger.info("Rejected an unreadable addon configuration.", {
      description: err.message,
    });
    res.status(400).send({ error: "Invalid addon configuration" });
  }
};

addon.get("/manifest.json", [respondWithHeaders, serveManifest]);
addon.get("/:userConfig/manifest.json", [
  respondWithHeaders,
  extractUserConfig,
  serveManifest,
]);

addon.get("/", landing);
addon.get("/configure", landing);

// The configure page checks the credentials here before handing out a link.
addon.post("/verify", verifyCredentials);

addon.get("/logo.png", (req, res) => {
  res.set("Cache-Control", "public, max-age=86400");
  res.sendFile(`${__dirname}/assets/logo.png`);
});

//Addon's readme request
addon.get("/README.md", (req, res) => {
  res.sendFile(`${__dirname}/README.md`);
});

addon.get("/:userConfig/subtitles/:type/:imdbId/:query?.json", [
  respondWithHeaders,
  extractUserConfig,
  extractTitleInfo,
  fetchSubsMiddleware,
  formatSubs,
]);

addon.get("/:userConfig/srt/:fileId.srt", [
  extractUserConfig,
  downloadSubtitle,
]);

function init() {
  logger.info("Starting initialization.");

  // Loud, but deliberately not fatal. Beamup creates the app on the first
  // deploy and can only be given its config afterwards, so the first boot
  // always happens without a key. Refusing to listen would fail that deploy
  // and leave no app to configure.
  if (!config.get("openSubtitles.apiKey")) {
    logger.error(new Error("OPENSUBTITLES_API_KEY is not set"), {
      description: "Every call to OpenSubtitles will fail until it is.",
    });
  }

  addon.listen(PORT, function () {
    logger.info(`Started addon on: ${HTTP}://${HOSTNAME}:${PORT}`);
  });
}

init();
