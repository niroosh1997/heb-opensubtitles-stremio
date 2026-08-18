const config = require("config");

// The port belongs in the url only when the addon is reached directly on it,
// which is local development over http. Anything on https sits behind
// something terminating tls on the standard port, and a port there produces
// urls Stremio cannot reach.
const addonBaseUrl = () => {
  const scheme = config.get("ssl") ? "https" : "http";
  const host = config.get("HOSTNAME");
  const port = config.get("ssl") ? "" : `:${config.get("PORT")}`;

  return `${scheme}://${host}${port}`;
};

module.exports = { addonBaseUrl };
