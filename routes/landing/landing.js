const configureTemplate = require("./configureTemplate");
const { MANIFEST } = require("../manifest");
const config = require("config");

const MAX_AGE_SECONDS = Number(config.get("configurePageCacheMaxAgeSeconds"));

// This page hands out the install link, and the link carries the addon's
// version, so a stale copy of the page installs a stale version of the addon.
// It has to be cheap to re-fetch rather than held for hours.
module.exports = (req, res) => {
  res.type("html");
  res.set("Cache-Control", `public, max-age=${MAX_AGE_SECONDS}`);
  res.send(configureTemplate(MANIFEST));
};
