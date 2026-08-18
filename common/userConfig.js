const CONFIG_KEYS = ["username", "password"];

const encode = (userConfig) =>
  Buffer.from(JSON.stringify(userConfig), "utf8").toString("base64url");

const decode = (segment) => {
  const decoded = JSON.parse(
    Buffer.from(segment, "base64url").toString("utf8")
  );

  for (const key of CONFIG_KEYS) {
    if (!decoded?.[key]) {
      throw new Error(`Missing ${key} in the addon configuration`);
    }
  }

  return { username: decoded.username, password: decoded.password };
};

// A first segment that is not one of the addon's own routes is the user's
// configuration, and it holds their password, so it is replaced before the url
// reaches a log. Anything unrecognised is redacted rather than logged, which is
// the safe direction to be wrong in.
const ROUTE_SEGMENTS = [
  "manifest.json",
  "subtitles",
  "srt",
  "configure",
  "verify",
  "README.md",
  "logo.png",
];

const redact = (url) => {
  const [path, ...rest] = url.split("?");
  const segments = path.split("/").filter(Boolean);

  if (segments.length === 0 || ROUTE_SEGMENTS.includes(segments[0])) {
    return url;
  }

  segments[0] = "<config>";
  const redacted = `/${segments.join("/")}`;

  return rest.length ? `${redacted}?${rest.join("?")}` : redacted;
};

module.exports = { encode, decode, redact };
