const config = require("config");
const { addonBaseUrl } = require("../common/addonUrl");
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

// The logo is served by the addon itself, so there is no third party left to
// take it down or rate limit it.
const withLogo = (manifest) => ({
  ...manifest,
  logo: `${addonBaseUrl()}/logo.png`,
});

const serveManifest = (req, res) => {
  res.send(withLogo(req.userConfig ? configuredManifest() : MANIFEST));
};

module.exports = { serveManifest, MANIFEST, configuredManifest };
