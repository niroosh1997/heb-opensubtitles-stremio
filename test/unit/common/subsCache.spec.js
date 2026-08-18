const assert = require("assert");
const sinon = require("sinon");
const proxyquire = require("proxyquire").noCallThru();

const FOUND_TTL = 200;
const EMPTY_TTL = 60;

// Comfortably inside or past a ttl, so a slow machine cannot flip the result.
const WELL_WITHIN = (ttl) => Math.floor(ttl / 4);
const WELL_PAST = (ttl) => ttl * 2;

const SUBS = [
  { id: "SUB1", subName: "Freies.Land.2019.D.BDRip.1.46Gb.MegaPeer.avi.srt" },
  { id: "SUB2", subName: "Freies.Land.2019.DVDRIP.MegaPeer.avi.srt" },
];

// Shaped like the req.title that extractTitleInfo builds: season and episode
// are strings for a series and present but undefined for a movie, and the
// languages asked for always come along.
const movie = (overrides = {}) => ({
  type: "movie",
  imdbID: "tt9407490",
  season: undefined,
  episode: undefined,
  languages: "he",
  ...overrides,
});

const episode = (overrides = {}) => ({
  type: "series",
  imdbID: "tt0903747",
  season: "2",
  episode: "5",
  languages: "he",
  ...overrides,
});

// The arguments Stremio appends to every subtitles request. They differ per
// viewer and must never split a cache entry.
const release = (title, filename, videoHash, videoSize) => ({
  ...title,
  filename,
  videoHash,
  videoSize,
});

// Every fetch hands back its own array so that a test mutating a result cannot
// change the fixture the next assertion relies on.
const countingFetch = (subs = SUBS) =>
  sinon.stub().callsFake(async () => [...subs]);

const loadCache = (overrides = {}) => {
  const values = {
    "subsCache.maxEntries": 500,
    "subsCache.foundTtlMs": FOUND_TTL,
    "subsCache.emptyTtlMs": EMPTY_TTL,
    ...overrides,
  };

  return proxyquire("../../../common/subsCache", {
    config: { get: (key) => values[key] },
    "./logger": { debug: sinon.spy(), info: sinon.spy(), error: sinon.spy() },
  });
};

const SHARE_ONE_FETCH = [
  {
    what: "a movie asked for by two different releases",
    first: release(
      movie(),
      "Freies.Land.2019.D.BDRip.1.46Gb.MegaPeer.avi",
      "fe4032afd8b70beb",
      "1567260672"
    ),
    second: release(
      movie(),
      "Freies.Land.2019.DVDRIP.MegaPeer.avi",
      "fe40328b70beb",
      "1401229312"
    ),
  },
  {
    what: "a movie asked for twice by the same release",
    first: release(movie(), "Freies.Land.2019.DVDRIP.avi", "aaa", "1"),
    second: release(movie(), "Freies.Land.2019.DVDRIP.avi", "aaa", "1"),
  },
  {
    what: "a movie with no extra arguments at all",
    first: movie(),
    second: movie(),
  },
  {
    what: "a movie whose undefined season and episode keys are absent instead",
    first: movie(),
    second: { type: "movie", imdbID: "tt9407490", languages: "he" },
  },
  {
    what: "an episode asked for by two different releases",
    first: release(
      episode(),
      "Breaking.Bad.S02E05.1080p.WEB-DL.mkv",
      "abc123",
      "1567260672"
    ),
    second: release(
      episode(),
      "Breaking.Bad.S02E05.720p.HDTV.x264.mkv",
      "def456",
      "734003200"
    ),
  },
  {
    what: "an episode asked for with and without extra arguments",
    first: episode(),
    second: release(episode(), "Breaking.Bad.S02E05.BluRay.mkv", "ghi789", "2"),
  },
];

const NEED_THEIR_OWN_FETCH = [
  {
    what: "two different movies",
    first: movie(),
    second: movie({ imdbID: "tt0111161" }),
  },
  {
    what: "two episodes of the same season",
    first: episode(),
    second: episode({ episode: "6" }),
  },
  {
    what: "the same episode number in two seasons",
    first: episode(),
    second: episode({ season: "3" }),
  },
  {
    what: "the same season and episode of two different series",
    first: episode(),
    second: episode({ imdbID: "tt0944947" }),
  },
  {
    what: "the same title asked for in two languages",
    first: movie(),
    second: movie({ languages: "en" }),
  },
  {
    what: "the same imdb id with nothing but the type to tell them apart",
    first: { type: "movie", imdbID: "tt0903747", languages: "he" },
    second: { type: "series", imdbID: "tt0903747", languages: "he" },
  },
  {
    what: "two releases of two different movies",
    first: release(movie(), "Freies.Land.2019.BDRip.avi", "aaa", "1"),
    second: release(
      movie({ imdbID: "tt0111161" }),
      "Shawshank.1994.BDRip.avi",
      "bbb",
      "2"
    ),
  },
];

describe("subsCache getOrFetch", function () {
  let getOrFetch;

  beforeEach(function () {
    ({ getOrFetch } = loadCache());
  });

  SHARE_ONE_FETCH.forEach(({ what, first, second }) => {
    it(`should ask OpenSubtitles once for ${what}`, async function () {
      const fetchSubs = countingFetch();

      const firstSubs = await getOrFetch(first, fetchSubs);
      const secondSubs = await getOrFetch(second, fetchSubs);

      assert.strictEqual(
        fetchSubs.callCount,
        1,
        `Expected one OpenSubtitles call for ${what}, got ${fetchSubs.callCount}`
      );
      assert.deepStrictEqual(firstSubs, SUBS);
      assert.deepStrictEqual(secondSubs, SUBS);
    });
  });

  NEED_THEIR_OWN_FETCH.forEach(({ what, first, second }) => {
    it(`should ask OpenSubtitles twice for ${what}`, async function () {
      const fetchSubs = countingFetch();

      await getOrFetch(first, fetchSubs);
      await getOrFetch(second, fetchSubs);

      assert.strictEqual(
        fetchSubs.callCount,
        2,
        `Expected two OpenSubtitles calls for ${what}, got ${fetchSubs.callCount}`
      );
    });
  });

  it("should ask OpenSubtitles once however many releases of one episode arrive", async function () {
    const fetchSubs = countingFetch();
    const releases = [
      "Breaking.Bad.S02E05.1080p.WEB-DL.mkv",
      "Breaking.Bad.S02E05.720p.HDTV.x264.mkv",
      "Breaking.Bad.S02E05.BluRay.x264-GROUP.mkv",
      "Breaking.Bad.S02E05.DVDRip.XviD.avi",
      "Breaking.Bad.S02E05.2160p.HDR.mkv",
    ];

    for (const filename of releases) {
      await getOrFetch(episode({ filename }), fetchSubs);
    }

    assert.strictEqual(
      fetchSubs.callCount,
      1,
      `Expected 1 OpenSubtitles call for ${releases.length} releases, got ${fetchSubs.callCount}`
    );
  });

  it("should share one fetch between requests that arrive together", async function () {
    let resolveFetch;
    const fetchSubs = sinon
      .stub()
      .returns(new Promise((resolve) => (resolveFetch = resolve)));

    const inFlight = Promise.all([
      getOrFetch(episode(), fetchSubs),
      getOrFetch(episode(), fetchSubs),
      getOrFetch(episode(), fetchSubs),
    ]);
    resolveFetch(SUBS);
    const results = await inFlight;

    assert.strictEqual(
      fetchSubs.callCount,
      1,
      "Requests arriving before the first one resolves should reuse it"
    );
    results.forEach((subs) => assert.deepStrictEqual(subs, SUBS));
  });

  it("should not cache a failed fetch", async function () {
    const fetchSubs = sinon.stub();
    fetchSubs.onFirstCall().rejects(new Error("opensubtitles is down"));
    fetchSubs.onSecondCall().callsFake(async () => [...SUBS]);

    await assert.rejects(() => getOrFetch(movie(), fetchSubs));
    const subs = await getOrFetch(movie(), fetchSubs);

    assert.strictEqual(
      fetchSubs.callCount,
      2,
      "A failure must not be remembered as this title's subtitles"
    );
    assert.deepStrictEqual(subs, SUBS);
  });

  it("should hand out a copy so a caller cannot reorder the cached list", async function () {
    const expectedOrder = SUBS.map((sub) => sub.id);
    const fetchSubs = countingFetch();

    const first = await getOrFetch(movie(), fetchSubs);
    first.reverse();

    const second = await getOrFetch(movie(), fetchSubs);

    assert.deepStrictEqual(
      second.map((sub) => sub.id),
      expectedOrder,
      "Sorting the returned array must not affect what the next request reads"
    );
  });

  it("should evict the least recently used title once it is full", async function () {
    ({ getOrFetch } = loadCache({ "subsCache.maxEntries": 2 }));
    const fetchSubs = countingFetch();

    await getOrFetch(movie({ imdbID: "tt0000001" }), fetchSubs);
    await getOrFetch(movie({ imdbID: "tt0000002" }), fetchSubs);
    await getOrFetch(movie({ imdbID: "tt0000003" }), fetchSubs);
    await getOrFetch(movie({ imdbID: "tt0000001" }), fetchSubs);

    assert.strictEqual(
      fetchSubs.callCount,
      4,
      "The oldest title should have been evicted, forcing a refetch"
    );
  });
});

// These use real, very short ttls rather than a faked clock. lru-cache reads
// its clock once when the module loads and keeps that reference, so whether a
// fake clock reaches it depends on module load order, which differs by Node
// version: faking Date worked on Node 18 and not from Node 20 on, where it
// picks performance.now() instead. Waiting a few real milliseconds is slower
// but behaves the same everywhere.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("subsCache getOrFetch expiry", function () {
  let getOrFetch;

  beforeEach(function () {
    ({ getOrFetch } = loadCache());
  });

  it("should keep a found list for the whole found ttl", async function () {
    const fetchSubs = countingFetch();

    await getOrFetch(movie(), fetchSubs);
    await sleep(WELL_WITHIN(FOUND_TTL));
    await getOrFetch(movie(), fetchSubs);

    assert.strictEqual(
      fetchSubs.callCount,
      1,
      "A found list should still be served just before its ttl"
    );
  });

  it("should refetch a found list once the found ttl passes", async function () {
    const fetchSubs = countingFetch();

    await getOrFetch(movie(), fetchSubs);
    await sleep(WELL_PAST(FOUND_TTL));
    await getOrFetch(movie(), fetchSubs);

    assert.strictEqual(fetchSubs.callCount, 2);
  });

  it("should outlive the empty ttl when subtitles were found", async function () {
    const fetchSubs = countingFetch();

    await getOrFetch(movie(), fetchSubs);
    await sleep(WELL_PAST(EMPTY_TTL));
    await getOrFetch(movie(), fetchSubs);

    assert.strictEqual(
      fetchSubs.callCount,
      1,
      "The short ttl is only meant for empty results"
    );
  });

  it("should keep an empty list only until the empty ttl", async function () {
    const fetchSubs = countingFetch([]);

    await getOrFetch(episode(), fetchSubs);
    await sleep(WELL_WITHIN(EMPTY_TTL));
    await getOrFetch(episode(), fetchSubs);

    assert.strictEqual(
      fetchSubs.callCount,
      1,
      "Should still be served just before the empty ttl"
    );
  });

  it("should retry an empty list soon after, the subs may not be up yet", async function () {
    const fetchSubs = countingFetch([]);

    await getOrFetch(episode(), fetchSubs);
    await sleep(WELL_PAST(EMPTY_TTL));
    await getOrFetch(episode(), fetchSubs);

    assert.strictEqual(fetchSubs.callCount, 2);
  });
});
