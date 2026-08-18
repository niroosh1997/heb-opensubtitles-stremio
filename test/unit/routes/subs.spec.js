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

  it("should leave the port out of the url when served over https", function () {
    // Anything on https is behind a tls terminator on the standard port, so a
    // port in the url gives Stremio something it cannot reach: the subtitles
    // list fine and then never download.
    const subs = proxyquire("../../../routes/subs", {
      "../clients/openSubtitles": { search: sinon.stub().resolves([]) },
      "../common/logger": { info() {}, debug() {}, error() {} },
      config: {
        get: (key) =>
          ({ PORT: 3000, ssl: true, HOSTNAME: "addon.example.com" }[key]),
        util: { getEnv: () => "development" },
      },
    });

    subs.formatSubs(requestWith(undefined), res);

    const { subtitles } = res.send.firstCall.args[0];
    assert.ok(
      !subtitles[0].url.includes(":3000"),
      `Port must not appear in an https url, got: ${subtitles[0].url}`
    );
    assert.ok(subtitles[0].url.startsWith("https://addon.example.com/"));
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
