const openSubtitles = require("../clients/openSubtitles");
const { type } = require("../common/mediaTypes");
const { getOrFetch } = require("../common/subsCache");
const { addonBaseUrl } = require("../common/addonUrl");
const logger = require("../common/logger");
const config = require("config");
const { distance } = require("fastest-levenshtein");

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
    subtitles: req.subs.map((sub) => ({
      id: `[OS]${sub.fileName || sub.release}`,
      lang: sub.language || "heb",
      url: formatSrtUrl(req.params.userConfig, sub.fileId),
    })),
  };

  sortSubsByFilename(stremioSubs, req?.title?.filename);
  res.send(stremioSubs);
};

const formatSrtUrl = (userConfig, fileId) =>
  `${addonBaseUrl()}/${userConfig}/srt/${fileId}.srt`;

const sortSubsByFilename = (stremioSubsArray, titleFilename) => {
  if (!titleFilename) {
    logger.debug("No filename was found. Returning unsorted subtitles array.");
    return;
  }

  stremioSubsArray.subtitles.sort((firstSub, secondSub) => {
    return (
      distance(titleFilename, firstSub.id.replace("[OS]", "")) -
      distance(titleFilename, secondSub.id.replace("[OS]", ""))
    );
  });
};

module.exports = { extractTitleInfo, fetchSubsMiddleware, formatSubs };
