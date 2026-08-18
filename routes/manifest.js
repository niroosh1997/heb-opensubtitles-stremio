const config = require("config");
const { addonBaseUrl } = require("../common/addonUrl");

const MANIFEST_MAX_AGE_SECONDS = Number(
  config.get("manifestCacheMaxAgeSeconds")
);
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

// Without a Cache-Control of its own the manifest inherited beamup's four
// hours, so a new version, logo or contact address took that long to reach
// anyone, and Stremio's catalogue could pick up a stale copy. It is small and
// changes rarely, but when it changes the change matters.
const serveManifest = (req, res) => {
  res.set("Cache-Control", `public, max-age=${MANIFEST_MAX_AGE_SECONDS}`);
  res.send(withLogo(req.userConfig ? configuredManifest() : MANIFEST));
};

module.exports = { serveManifest, MANIFEST, configuredManifest };
