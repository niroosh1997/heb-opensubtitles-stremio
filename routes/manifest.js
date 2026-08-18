const config = require("config");
const PACKAGE_VERSION = require("../package.json").version;

const CONFIG_FIELDS = [
  {
    key: "username",
    title: "OpenSubtitles username",
    type: "text",
    required: true,
  },
  {
    key: "password",
    title: "OpenSubtitles password",
    type: "password",
    required: true,
  },
];

const MANIFEST = {
  id: "heb.stremio.opensubtitles",
  contactEmail: config.get("addonAuthorEmail"),
  version: process.env.npm_package_version || PACKAGE_VERSION,
  catalogs: [],
  resources: ["subtitles"],
  types: ["movie", "series"],
  name: "Hebrew OpenSubtitles",
  description:
    "An unofficial Stremio addon for Hebrew subtitles from OpenSubtitles. Each user signs in with their own account, so downloads count against their own daily quota.",
  config: CONFIG_FIELDS,
  behaviorHints: { configurable: true, configurationRequired: true },
};

// Once the user has configured the addon there is nothing left to require, and
// leaving configurationRequired set makes Stremio ask again on every install.
const configuredManifest = () => {
  const manifest = { ...MANIFEST, behaviorHints: { configurable: true } };
  return manifest;
};

const serveManifest = (req, res) => {
  res.send(req.userConfig ? configuredManifest() : MANIFEST);
};

module.exports = { serveManifest, MANIFEST, configuredManifest };
