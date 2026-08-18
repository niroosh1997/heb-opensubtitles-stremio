const config = require("config");
const PACKAGE_VERSION = require("../package.json").version;

const MANIFEST = {
  id: "heb.stremio.opensubtitles",
  contactEmail: config.get("addonAuthorEmail"),
  version: process.env.npm_package_version || PACKAGE_VERSION,
  catalogs: [],
  resources: ["subtitles"],
  types: ["movie", "series"],
  name: "Hebrew OpenSubtitles",
  description:
    "An unofficial Stremio addon for Hebrew subtitles from OpenSubtitles.",
};

const serveManifest = (req, res) => {
  res.send(MANIFEST);
};

module.exports = { serveManifest, MANIFEST };
