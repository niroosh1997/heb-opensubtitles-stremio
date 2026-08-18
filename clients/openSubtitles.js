const axios = require("axios");
const crypto = require("crypto");
const config = require("config");
const { LRUCache } = require("lru-cache");
const logger = require("../common/logger");
const PACKAGE = require("../package.json");

const API_KEY = config.get("openSubtitles.apiKey");
const DEFAULT_HOST = config.get("openSubtitles.host");
const USER_AGENT = `${PACKAGE.name} v${PACKAGE.version}`;
const TIMEOUT_MS = Number(config.get("openSubtitles.timeoutMs"));

// Logging in is rate limited to 1 request per second, 10 per minute and 30 per
// hour, so a token is kept for as long as it is useful rather than fetched per
// request. Keyed on the username, never the password.
const sessions = new LRUCache({
  max: Number(config.get("openSubtitles.maxSessions")),
  ttl: Number(config.get("openSubtitles.sessionTtlMs")),
});

// Credentials OpenSubtitles has already rejected. Their docs say to stop
// sending a login that came back 401, and Stremio retries a failed subtitle
// more than a dozen times in a few seconds, so without this one wrong password
// spends a dozen of the thirty logins allowed per hour.
const rejected = new LRUCache({
  max: Number(config.get("openSubtitles.maxSessions")),
  ttl: Number(config.get("openSubtitles.rejectedTtlMs")),
});

// Hashed so a rejected password is not held in memory.
const credentialKey = ({ username, password }) =>
  crypto.createHash("sha256").update(`${username}:${password}`).digest("hex");

const rejectedError = () => {
  const err = new Error("OpenSubtitles rejected these credentials");
  err.response = { status: 401 };
  err.alreadyRejected = true;
  return err;
};

// Axios reports only "Request failed with status code N". OpenSubtitles puts
// the reason in the response body, so it is attached to the error where the
// logs can reach it.
const withResponseBody = (err) => {
  const body = err.response?.data;

  if (body) {
    err.message = `${err.message}: ${
      typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body)
    }`;
  }

  throw err;
};

const api = (host) => {
  const instance = axios.create({
    baseURL: `https://${host}/api/v1`,
    timeout: TIMEOUT_MS,
    headers: {
      "Api-Key": API_KEY,
      "User-Agent": USER_AGENT,
      // Sent explicitly because axios defaults to
      // "application/json, text/plain, */*", which OpenSubtitles' edge answers
      // with a 503 html page instead of the api's json.
      Accept: "application/json",
    },
  });

  instance.interceptors.response.use((res) => res, withResponseBody);

  return instance;
};

// OpenSubtitles wants the imdb id as a plain integer: no tt prefix and no
// leading zeroes, or the request is redirected.
const toImdbNumber = (imdbID) => Number(String(imdbID).replace(/^tt/, ""));

const login = async ({ username, password }) => {
  // Keyed on the password as well as the username. Keyed on the username alone,
  // any password at all would be answered with whichever session that user had
  // already established, so a wrong password looked accepted and would have
  // spent their downloads.
  const key = credentialKey({ username, password });

  const cached = sessions.get(key);
  if (cached) {
    return cached;
  }

  if (rejected.has(key)) {
    logger.debug("Skipping a login already rejected.", { username });
    throw rejectedError();
  }

  logger.info("Logging in to OpenSubtitles.", { username });

  let data;
  try {
    ({ data } = await api(DEFAULT_HOST).post("/login", { username, password }));
  } catch (err) {
    if (err.response?.status === 401) {
      rejected.set(key, true);
    }
    throw err;
  }

  const session = {
    token: data.token,
    // Further requests must continue on the host the login handed back, which
    // is vip-api for VIP accounts and has its own limits and cache times.
    host: data.base_url || DEFAULT_HOST,
    allowedDownloads: data.user?.allowed_downloads,
    vip: Boolean(data.user?.vip),
  };

  sessions.set(key, session);
  rejected.delete(key);
  logger.debug("OpenSubtitles session established.", {
    username,
    host: session.host,
    allowedDownloads: session.allowedDownloads,
    vip: session.vip,
  });

  return session;
};

const forgetSession = (credentials) =>
  sessions.delete(credentialKey(credentials));

// Parameters are sent sorted and lowercased with no default values, which is
// what OpenSubtitles asks for to avoid a redirect and to hit their cache.
const searchParams = ({ imdbID, season, episode, languages }) => {
  const params = { languages };

  if (season !== undefined && episode !== undefined) {
    params.episode_number = Number(episode);
    params.parent_imdb_id = toImdbNumber(imdbID);
    params.season_number = Number(season);
  } else {
    params.imdb_id = toImdbNumber(imdbID);
  }

  return Object.fromEntries(Object.entries(params).sort());
};

const search = async (title, session) => {
  const params = searchParams(title);

  logger.info("Searching OpenSubtitles.", params);

  const { data } = await api(session?.host || DEFAULT_HOST).get("/subtitles", {
    params,
    headers: session ? { Authorization: `Bearer ${session.token}` } : {},
  });

  return (data.data || []).flatMap((result) =>
    (result.attributes?.files || []).map((file) => ({
      fileId: file.file_id,
      fileName: file.file_name,
      release: result.attributes.release,
      language: result.attributes.language,
    }))
  );
};

// The download count is spent on this call, not on fetching the file, and the
// link it returns is only valid for a few hours.
const requestDownloadLink = async (fileId, session) => {
  const { data } = await api(session.host).post(
    "/download",
    { file_id: Number(fileId) },
    { headers: { Authorization: `Bearer ${session.token}` } }
  );

  logger.info("Spent an OpenSubtitles download.", {
    fileId,
    remaining: data.remaining,
    resetTimeUtc: data.reset_time_utc,
  });

  return data.link;
};

const fetchSubtitleFile = async (link) => {
  // Subtitles behind a download link are always served as UTF-8.
  const { data } = await axios.get(link, {
    timeout: TIMEOUT_MS,
    responseType: "text",
    headers: { "User-Agent": USER_AGENT },
  });

  return data;
};

module.exports = {
  login,
  credentialsAreKnownBad: (credentials) =>
    rejected.has(credentialKey(credentials)),
  forgetSession,
  search,
  requestDownloadLink,
  fetchSubtitleFile,
};
