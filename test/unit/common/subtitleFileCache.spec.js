const assert = require("assert");
const sinon = require("sinon");
const proxyquire = require("proxyquire").noCallThru();

const SRT = "1\n00:00:01,000 --> 00:00:04,000\nשלום עולם\n";

const loadCache = (overrides = {}) => {
  const values = {
    "subtitleFileCache.maxBytes": 33554432,
    "subtitleFileCache.ttlMs": 21600000,
    ...overrides,
  };

  return proxyquire("../../../common/subtitleFileCache", {
    config: { get: (key) => values[key] },
    "./logger": { debug: sinon.spy() },
  });
};

describe("subtitleFileCache", function () {
  let getOrFetch;

  beforeEach(function () {
    ({ getOrFetch } = loadCache());
  });

  it("should download a file it has not seen", async function () {
    const fetchSubtitle = sinon.stub().resolves(SRT);

    const content = await getOrFetch("111", fetchSubtitle);

    assert.strictEqual(content, SRT);
    assert.ok(fetchSubtitle.calledOnce);
  });

  it("should not download the same file twice", async function () {
    const fetchSubtitle = sinon.stub().resolves(SRT);

    await getOrFetch("111", fetchSubtitle);
    const second = await getOrFetch("111", fetchSubtitle);

    assert.strictEqual(fetchSubtitle.callCount, 1);
    assert.strictEqual(second, SRT);
  });

  it("should keep different files apart", async function () {
    // The mistake worth guarding: a key that ignores part of its input. The
    // session cache had exactly this bug, keyed on the username and ignoring
    // the password.
    const fetchSubtitle = sinon
      .stub()
      .callsFake(async (...args) => args.join());

    const first = await getOrFetch("111", () => Promise.resolve("file-111"));
    const second = await getOrFetch("222", () => Promise.resolve("file-222"));

    assert.strictEqual(first, "file-111");
    assert.strictEqual(
      second,
      "file-222",
      "Two file ids must not share an entry"
    );
    assert.ok(fetchSubtitle.notCalled);
  });

  it("should share one download between requests that arrive together", async function () {
    // Stremio asks for the same subtitle several times within a second.
    let resolveFetch;
    const fetchSubtitle = sinon
      .stub()
      .returns(new Promise((resolve) => (resolveFetch = resolve)));

    const inFlight = Promise.all([
      getOrFetch("111", fetchSubtitle),
      getOrFetch("111", fetchSubtitle),
      getOrFetch("111", fetchSubtitle),
    ]);
    resolveFetch(SRT);
    const results = await inFlight;

    assert.strictEqual(fetchSubtitle.callCount, 1);
    results.forEach((content) => assert.strictEqual(content, SRT));
  });

  it("should not remember a failed download", async function () {
    const fetchSubtitle = sinon.stub();
    fetchSubtitle.onFirstCall().rejects(new Error("opensubtitles is down"));
    fetchSubtitle.onSecondCall().resolves(SRT);

    await assert.rejects(() => getOrFetch("111", fetchSubtitle));
    const content = await getOrFetch("111", fetchSubtitle);

    assert.strictEqual(fetchSubtitle.callCount, 2);
    assert.strictEqual(content, SRT);
  });

  it("should drop the oldest file when it runs out of room", async function () {
    // Sized in bytes rather than entries, because subtitles range from a few
    // kilobytes to a couple of hundred.
    ({ getOrFetch } = loadCache({ "subtitleFileCache.maxBytes": 100 }));
    const big = "x".repeat(60);

    await getOrFetch("111", () => Promise.resolve(big));
    await getOrFetch("222", () => Promise.resolve(big));

    const refetch = sinon.stub().resolves(big);
    await getOrFetch("111", refetch);

    assert.ok(refetch.calledOnce, "The first file should have been evicted");
  });
});
