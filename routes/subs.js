const openSubtitles = require("../clients/openSubtitles");
const { type } = require("../common/mediaTypes");
const { getOrFetch } = require("../common/subsCache");
const { addonBaseUrl } = require("../common/addonUrl");
const logger = require("../common/logger");
const config = require("config");
const { distance } = require("fastest-levenshtein");
const { familyOfFilename, matchTier } = require("../common/frameRate");

const LANGUAGES = config.get("openSubtitles.languages");
const imdbIDRegex = /^tt\d{7,9}$/;

const exitEarlyWithEmptySubtitlesArray = (res) => {
  res.send({ subtitles: [] });
};

const extractTitleInfo = (req, res, next) => {
  const requestedType = req.params.type;
  const [imdbID, season, episode] = req.params.imdbId.split(":");

  if (!imdbIDRegex.test(imdbID)) {
    logger.info("Invalid imdb ID", { imdbID });
    exitEarlyWithEmptySubtitlesArray(res);
    return;
  }

  req.title = {
    type: requestedType,
    imdbID,
    season,
    episode,
    languages: LANGUAGES,
    ...extractExtraArgs(req.params?.query),
  };

  next();
};

const extractExtraArgs = (query) => {
  if (!query) {
    return {};
  }

  const extraArgs = {};
  for (const arg of query.split("&")) {
    const [key, value] = arg.split("=");
    extraArgs[key] = value;
  }

  return extraArgs;
};

// The subtitles list is the same whoever asks for it, so it is fetched without
// a session and shared by every user. Only downloading is per user.
const fetchSubsFromOpenSubtitles = async (title) => {
  switch (title.type) {
    case type.MOVIE:
      return openSubtitles.search({
        imdbID: title.imdbID,
        languages: title.languages,
      });
    case type.SERIES:
      return openSubtitles.search({
        imdbID: title.imdbID,
        season: title.season,
        episode: title.episode,
        languages: title.languages,
      });
    default:
      logger.info("Unknown type found", { type: title.type });
      return [];
  }
};

const fetchSubsMiddleware = async (req, res, next) => {
  try {
    const found = await getOrFetch(req.title, () =>
      fetchSubsFromOpenSubtitles(req.title)
    );
    logger.debug("Resolved title subs.", {
      imdbID: req.title?.imdbID,
      subsFound: found?.length ?? 0,
    });
    req.subs = found;
    next();
  } catch (err) {
    logger.error(err, {
      description:
        "Error occurred while fetching title subs from OpenSubtitles",
      title: JSON.stringify(req.title || {}),
    });
    req.subs = [];
    next();
  }
};

const formatSubs = (req, res) => {
  // Definition for a Stremio sub file can found here: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/subtitles.md
  const stremioSubs = {
    subtitles: rankSubs(req.subs, req?.title?.filename).map((sub) => ({
      id: `[OS]${sub.fileName || sub.release}`,
      lang: sub.language || "heb",
      url: formatSrtUrl(req.params.userConfig, sub.fileId),
    })),
  };

  res.send(stremioSubs);
};

const formatSrtUrl = (userConfig, fileId) =>
  `${addonBaseUrl()}/${userConfig}/srt/${fileId}.srt`;

const nameOf = (sub) => sub.fileName || sub.release || "";

// Frame rate decides the order and the name only breaks ties within it. A
// subtitle timed against the wrong rate drifts further apart the longer the
// video runs and no fixed delay puts it right, while a name belonging to
// another release of the same rate is usually a second or two out at worst.
// Sorting a copy keeps the array the cache handed over in its own order.
const rankSubs = (subs, titleFilename) => {
  if (!titleFilename) {
    logger.debug("No filename was found. Returning unsorted subtitles array.");
    return subs;
  }

  const videoFrameRate = familyOfFilename(titleFilename);

  logger.debug("Ranking subtitles.", {
    videoFrameRate: videoFrameRate || "unknown",
    subs: subs.length,
  });

  return [...subs]
    .map((sub) => ({
      sub,
      frameRateTier: matchTier(videoFrameRate, sub.fps),
      nameDistance: distance(titleFilename, nameOf(sub)),
    }))
    .sort(
      (first, second) =>
        first.frameRateTier - second.frameRateTier ||
        first.nameDistance - second.nameDistance
    )
    .map(({ sub }) => sub);
};

module.exports = { extractTitleInfo, fetchSubsMiddleware, formatSubs };
