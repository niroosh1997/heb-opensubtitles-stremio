// OpenSubtitles reports the frame rate a subtitle was timed against, but
// Stremio never sends the video's, so it has to be inferred from the release
// name. Only two families matter: film rate (23.976 or 24, what every digital
// source carries) and PAL (25), which comes from European broadcast and the
// DVDs ripped from it. A subtitle timed for one and played against the other
// drifts by about four percent, which is several minutes by the end of a
// feature and cannot be corrected with a fixed delay.

const FILM = "film";
const PAL = "pal";

// Deliberately narrow. HDTV is 25 in Europe and 23.976 in the US, and a DVDRip
// is either depending on the region it was pressed for, so neither is claimed
// here: an unknown rate is treated as neutral and left to the filename to
// order, which is better than confidently demoting a subtitle that fits.
const PAL_MARKERS = /(^|[^a-z0-9])(pal|25fps)([^a-z0-9]|$)/i;
const FILM_MARKERS =
  /(^|[^a-z0-9])(bluray|blu-ray|bdrip|brrip|bdremux|remux|webdl|web-dl|webrip|web-rip|amzn|nf|dsnp|hmax|atvp|uhd|2160p|hdr|ntsc|23976|24fps)([^a-z0-9]|$)/i;

// The rate OpenSubtitles reports is a number, and zero means they do not know
// it, which roughly one subtitle in seven is.
const familyOfRate = (fps) => {
  const rate = Number(fps);

  if (!rate || rate <= 0) {
    return undefined;
  }

  return rate >= 24.5 ? PAL : FILM;
};

const familyOfFilename = (filename) => {
  if (!filename) {
    return undefined;
  }

  if (PAL_MARKERS.test(filename)) {
    return PAL;
  }

  return FILM_MARKERS.test(filename) ? FILM : undefined;
};

// Lower sorts first: 0 the rates agree, 1 one of them is unknown, 2 they
// disagree. Unknown sits in the middle rather than last so that a subtitle
// whose rate was never recorded is not ranked below one known to be wrong.
const RATES_AGREE = 0;
const RATE_UNKNOWN = 1;
const RATES_DISAGREE = 2;

const matchTier = (videoFamily, fps) => {
  const subtitleFamily = familyOfRate(fps);

  if (!videoFamily || !subtitleFamily) {
    return RATE_UNKNOWN;
  }

  return videoFamily === subtitleFamily ? RATES_AGREE : RATES_DISAGREE;
};

module.exports = {
  FILM,
  PAL,
  RATES_AGREE,
  RATE_UNKNOWN,
  RATES_DISAGREE,
  familyOfRate,
  familyOfFilename,
  matchTier,
};
