const assert = require("assert");
const sinon = require("sinon");
const proxyquire = require("proxyquire").noCallThru();

const TTL = 200;
const WELL_WITHIN = Math.floor(TTL / 4);
const WELL_PAST = TTL * 2;

const VIEWER = { username: "viewer", password: "hunter2" };
const OTHER = { username: "other", password: "swordfish" };

const loadCache = (overrides = {}) => {
  const values = {
    "downloadFailureCache.maxEntries": 500,
    "downloadFailureCache.ttlMs": TTL,
    ...overrides,
  };

  return proxyquire("../../../common/downloadFailureCache", {
    config: { get: (key) => values[key] },
    "./logger": { debug: sinon.spy() },
  });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("downloadFailureCache", function () {
  let cache;

  beforeEach(function () {
    cache = loadCache();
  });

  it("should hand back the status a download failed with", function () {
    cache.remember("111", VIEWER, 429);

    assert.strictEqual(cache.recall("111", VIEWER), 429);
  });

  it("should know nothing about a download that has not failed", function () {
    assert.strictEqual(cache.recall("111", VIEWER), undefined);
  });

  it("should keep different files apart", function () {
    cache.remember("111", VIEWER, 502);

    assert.strictEqual(
      cache.recall("222", VIEWER),
      undefined,
      "One unusable file must not refuse another"
    );
  });

  it("should keep one account's failure to itself", function () {
    // The quota that ran out is one account's. Keyed on the file id alone, the
    // first user to run out would refuse that subtitle to everyone else.
    cache.remember("111", VIEWER, 429);

    assert.strictEqual(
      cache.recall("111", OTHER),
      undefined,
      "Another account's quota is its own"
    );
  });

  it("should not let a wrong password speak for the account", function () {
    // The same mistake the session cache once made, keyed on the username and
    // ignoring the password. Here it would refuse the real user because of
    // someone else's typo.
    cache.remember("111", { ...VIEWER, password: "wrong" }, 401);

    assert.strictEqual(cache.recall("111", VIEWER), undefined);
  });

  it("should forget a failure on request", function () {
    cache.remember("111", VIEWER, 502);
    cache.forget("111", VIEWER);

    assert.strictEqual(cache.recall("111", VIEWER), undefined);
  });

  it("should hold a failure for the whole ttl", async function () {
    cache.remember("111", VIEWER, 502);
    await sleep(WELL_WITHIN);

    assert.strictEqual(cache.recall("111", VIEWER), 502);
  });

  it("should let go of a failure once the ttl passes", async function () {
    // Short lived on purpose: it is there to absorb Stremio's burst of retries,
    // not to keep a subtitle unavailable after the trouble has passed.
    cache.remember("111", VIEWER, 502);
    await sleep(WELL_PAST);

    assert.strictEqual(cache.recall("111", VIEWER), undefined);
  });
});
