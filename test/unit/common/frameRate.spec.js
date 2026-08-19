const assert = require("assert");
const {
  FILM,
  PAL,
  RATES_AGREE,
  RATE_UNKNOWN,
  RATES_DISAGREE,
  familyOfRate,
  familyOfFilename,
  matchTier,
} = require("../../../common/frameRate");

const FILENAMES = [
  {
    what: "a bluray rip",
    filename: "Movie.2019.1080p.BluRay.x264-GROUP.mkv",
    family: FILM,
  },
  {
    what: "a web-dl",
    filename: "Movie.2019.1080p.WEB-DL.DDP5.1.H264-NTb.mkv",
    family: FILM,
  },
  {
    what: "a 4k remux",
    filename: "Movie.2019.2160p.UHD.BluRay.REMUX.HDR.mkv",
    family: FILM,
  },
  {
    what: "an amazon rip",
    filename: "Movie.2019.1080p.AMZN.WEBRip.DDP5.1.mkv",
    family: FILM,
  },
  {
    what: "an ntsc dvd rip",
    filename: "Movie.2019.NTSC.DVDRip.XviD.avi",
    family: FILM,
  },
  {
    what: "a pal dvd rip",
    filename: "Movie.2019.PAL.DVDRip.XviD-GROUP.avi",
    family: PAL,
  },
  {
    what: "a rate stated outright",
    filename: "Movie.2019.25fps.avi",
    family: PAL,
  },
  {
    what: "an hdtv rip, 25 in europe and 23.976 in the states",
    filename: "Movie.2019.720p.HDTV.x264.mkv",
    family: undefined,
  },
  {
    what: "a dvd rip of no stated region",
    filename: "Movie.2019.DVDRip.XviD.avi",
    family: undefined,
  },
  { what: "a bare name", filename: "Movie.2019.avi", family: undefined },
  { what: "no filename at all", filename: undefined, family: undefined },
];

describe("frameRate familyOfFilename", function () {
  FILENAMES.forEach(({ what, filename, family }) => {
    it(`should read ${what} as ${family || "unknown"}`, function () {
      assert.strictEqual(familyOfFilename(filename), family);
    });
  });

  it("should not mistake a word that merely contains a marker", function () {
    assert.strictEqual(
      familyOfFilename("Movie.2019.PALACE.Hotel.avi"),
      undefined
    );
  });
});

describe("frameRate familyOfRate", function () {
  [
    { rate: 23.976, family: FILM },
    { rate: 23.98, family: FILM },
    { rate: 24, family: FILM },
    { rate: 25, family: PAL },
    { rate: 30, family: PAL },
    { rate: 0, family: undefined },
    { rate: undefined, family: undefined },
    { rate: null, family: undefined },
  ].forEach(({ rate, family }) => {
    it(`should read ${rate} as ${family || "unknown"}`, function () {
      assert.strictEqual(familyOfRate(rate), family);
    });
  });
});

describe("frameRate matchTier", function () {
  it("should rank a matching rate first", function () {
    assert.strictEqual(matchTier(FILM, 23.976), RATES_AGREE);
    assert.strictEqual(matchTier(PAL, 25), RATES_AGREE);
  });

  it("should rank a clashing rate last", function () {
    assert.strictEqual(matchTier(FILM, 25), RATES_DISAGREE);
    assert.strictEqual(matchTier(PAL, 23.976), RATES_DISAGREE);
  });

  it("should leave an unrecorded subtitle rate in the middle", function () {
    assert.strictEqual(matchTier(FILM, 0), RATE_UNKNOWN);
  });

  it("should leave every subtitle in the middle when the video's rate is a guess", function () {
    assert.strictEqual(matchTier(undefined, 25), RATE_UNKNOWN);
    assert.strictEqual(matchTier(undefined, 23.976), RATE_UNKNOWN);
  });

  it("should keep unknown ahead of a known clash", function () {
    assert.ok(
      matchTier(FILM, 0) < matchTier(FILM, 25),
      "A subtitle of unrecorded rate should outrank one known to be wrong"
    );
  });
});
