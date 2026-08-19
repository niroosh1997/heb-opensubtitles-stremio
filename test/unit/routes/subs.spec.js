const assert = require("assert");
const sinon = require("sinon");
const proxyquire = require("proxyquire").noCallThru();

const USER_CONFIG_SEGMENT = "eyJ1c2VybmFtZSI6InZpZXdlciJ9";

const FOUND = [
  { fileId: 111, fileName: "Freies.Land.2019.DVDRIP.he.srt", language: "he" },
  { fileId: 222, fileName: "Freies.Land.2019.BDRip.he.srt", language: "he" },
];

const loadSubs = (search) =>
  proxyquire("../../../routes/subs", {
    "../clients/openSubtitles": { search },
    "../common/logger": {
      info: sinon.spy(),
      debug: sinon.spy(),
      error: sinon.spy(),
    },
    "../common/subsCache": proxyquire("../../../common/subsCache", {
      config: {
        get: (key) =>
          ({
            "subsCache.maxEntries": 500,
            "subsCache.foundTtlMs": 60000,
            "subsCache.emptyTtlMs": 5000,
          }[key]),
      },
      "./logger": { debug: sinon.spy() },
    }),
  });

describe("extractTitleInfo", function () {
  it("should split a series id into its imdb id, season and episode", function () {
    const { extractTitleInfo } = loadSubs(sinon.stub().resolves([]));
    const req = { params: { type: "series", imdbId: "tt0903747:2:5" } };
    const next = sinon.spy();

    extractTitleInfo(req, { send: sinon.spy() }, next);

    assert.ok(next.called);
    assert.strictEqual(req.title.imdbID, "tt0903747");
    assert.strictEqual(req.title.season, "2");
    assert.strictEqual(req.title.episode, "5");
  });

  it("should keep the filename off to one side for sorting", function () {
    const { extractTitleInfo } = loadSubs(sinon.stub().resolves([]));
    const req = {
      params: {
        type: "movie",
        imdbId: "tt9407490",
        query: "videoHash=abc&videoSize=1&filename=Freies.Land.2019.DVDRIP.avi",
      },
    };

    extractTitleInfo(req, { send: sinon.spy() }, sinon.spy());

    assert.strictEqual(req.title.filename, "Freies.Land.2019.DVDRIP.avi");
  });

  it("should answer an invalid imdb id with an empty list", function () {
    const { extractTitleInfo } = loadSubs(sinon.stub().resolves([]));
    const res = { send: sinon.spy() };
    const next = sinon.spy();

    extractTitleInfo({ params: { type: "movie", imdbId: "nope" } }, res, next);

    assert.ok(res.send.calledWith({ subtitles: [] }));
    assert.ok(next.notCalled, "The chain should stop on an invalid id");
  });
});

describe("fetchSubsMiddleware", function () {
  const titleFor = (filename) => ({
    type: "movie",
    imdbID: "tt9407490",
    season: undefined,
    episode: undefined,
    languages: "he",
    filename,
  });

  const callWith = async (subs, filename) => {
    const req = { title: titleFor(filename) };
    await subs.fetchSubsMiddleware(req, { send: sinon.spy() }, () => {});
    return req;
  };

  it("should search OpenSubtitles once for two viewers on different releases", async function () {
    const search = sinon.stub().callsFake(async () => [...FOUND]);
    const subs = loadSubs(search);

    await callWith(subs, "Freies.Land.2019.DVDRIP.avi");
    await callWith(subs, "Freies.Land.2019.BDRip.avi");

    assert.strictEqual(
      search.callCount,
      1,
      "The second viewer should have been served from the cache"
    );
  });

  it("should fall back to an empty list when the search fails", async function () {
    const search = sinon.stub().rejects(new Error("opensubtitles is down"));
    const subs = loadSubs(search);

    const req = await callWith(subs, "Freies.Land.2019.DVDRIP.avi");

    assert.deepStrictEqual(req.subs, []);
  });
});

describe("formatSubs", function () {
  let res;

  beforeEach(function () {
    res = { send: sinon.spy() };
  });

  const requestWith = (filename) => ({
    params: { userConfig: USER_CONFIG_SEGMENT },
    subs: [...FOUND],
    title: { filename },
  });

  it("should point each subtitle at this addon, carrying the user's config", function () {
    const { formatSubs } = loadSubs(sinon.stub().resolves([]));

    formatSubs(requestWith(undefined), res);

    const { subtitles } = res.send.firstCall.args[0];
    assert.ok(
      subtitles[0].url.endsWith(`/${USER_CONFIG_SEGMENT}/srt/111.srt`),
      `Unexpected url: ${subtitles[0].url}`
    );
  });

  it("should build the url from the addon's own base url", function () {
    const subs = proxyquire("../../../routes/subs", {
      "../clients/openSubtitles": { search: sinon.stub().resolves([]) },
      "../common/logger": { info() {}, debug() {}, error() {} },
      "../common/addonUrl": { addonBaseUrl: () => "https://addon.example.com" },
    });

    subs.formatSubs(requestWith(undefined), res);

    const { subtitles } = res.send.firstCall.args[0];
    assert.strictEqual(
      subtitles[0].url,
      `https://addon.example.com/${USER_CONFIG_SEGMENT}/srt/111.srt`
    );
  });

  it("should label the subtitles and their language", function () {
    const { formatSubs } = loadSubs(sinon.stub().resolves([]));

    formatSubs(requestWith(undefined), res);

    const { subtitles } = res.send.firstCall.args[0];
    assert.strictEqual(subtitles[0].id, "[OS]Freies.Land.2019.DVDRIP.he.srt");
    assert.strictEqual(subtitles[0].lang, "he");
  });

  it("should put the closest release first", function () {
    const { formatSubs } = loadSubs(sinon.stub().resolves([]));

    formatSubs(requestWith("Freies.Land.2019.BDRip.avi"), res);

    const { subtitles } = res.send.firstCall.args[0];
    assert.ok(
      subtitles[0].id.includes("BDRip"),
      `Expected the BDRip subtitle first, got: ${subtitles[0].id}`
    );
  });

  it("should return an empty array when nothing was found", function () {
    const { formatSubs } = loadSubs(sinon.stub().resolves([]));

    formatSubs({ params: {}, subs: [], title: {} }, res);

    assert.deepStrictEqual(res.send.firstCall.args[0], { subtitles: [] });
  });
});

describe("formatSubs ranking", function () {
  let res;

  beforeEach(function () {
    res = { send: sinon.spy() };
  });

  // A bluray video runs at film rate, so a 25 fps subtitle drifts against it
  // however well its name reads.
  const BLURAY = "Freies.Land.2019.1080p.BluRay.x264-GROUP.mkv";

  const named = (fileName, fps) => ({
    fileId: 1,
    fileName,
    fps,
    language: "he",
  });

  const rank = (filename, subs) => {
    const { formatSubs } = loadSubs(sinon.stub().resolves([]));

    formatSubs(
      {
        params: { userConfig: USER_CONFIG_SEGMENT },
        subs,
        title: { filename },
      },
      res
    );

    return res.send.firstCall.args[0].subtitles.map((sub) =>
      sub.id.replace("[OS]", "")
    );
  };

  it("should put a fitting frame rate ahead of a closer name", function () {
    const order = rank(BLURAY, [
      named("Freies.Land.2019.1080p.BluRay.x264-GROUP.srt", 25),
      named("Freies.Land.2019.720p.WEB-DL.srt", 23.976),
    ]);

    assert.strictEqual(
      order[0],
      "Freies.Land.2019.720p.WEB-DL.srt",
      "A 25 fps subtitle drifts apart all the way through, a mismatched name does not"
    );
  });

  it("should order by name among subtitles of the same frame rate", function () {
    const order = rank(BLURAY, [
      named("Freies.Land.2019.DVDRip.XviD.srt", 23.976),
      named("Freies.Land.2019.1080p.BluRay.x264-GROUP.srt", 23.976),
    ]);

    assert.strictEqual(
      order[0],
      "Freies.Land.2019.1080p.BluRay.x264-GROUP.srt",
      "With the rate settled the closest name should win"
    );
  });

  it("should keep an unrecorded rate ahead of one known to clash", function () {
    const order = rank(BLURAY, [
      named("Freies.Land.2019.1080p.BluRay.x264-GROUP.srt", 25),
      named("Freies.Land.2019.WHOKNOWS.srt", 0),
    ]);

    assert.strictEqual(
      order[0],
      "Freies.Land.2019.WHOKNOWS.srt",
      "A subtitle whose rate was never recorded may still fit; one at 25 fps will not"
    );
  });

  it("should fall back to the name alone when the video's rate cannot be told", function () {
    // An hdtv rip is 25 fps in Europe and 23.976 in the states, so nothing can
    // be concluded from it and every subtitle stays on its name.
    const order = rank("Freies.Land.2019.720p.HDTV.x264.mkv", [
      named("Freies.Land.2019.WEB-DL.srt", 25),
      named("Freies.Land.2019.720p.HDTV.x264.srt", 23.976),
    ]);

    assert.strictEqual(order[0], "Freies.Land.2019.720p.HDTV.x264.srt");
  });

  it("should leave the order alone when no filename was sent", function () {
    const order = rank(undefined, [
      named("second.srt", 25),
      named("first.srt", 23.976),
    ]);

    assert.deepStrictEqual(order, ["second.srt", "first.srt"]);
  });
});
