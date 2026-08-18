const assert = require("assert");
const sinon = require("sinon");
const proxyquire = require("proxyquire").noCallThru();

const SRT = "1\n00:00:01,000 --> 00:00:04,000\nשלום עולם\n";
const SESSION = { token: "jwt", host: "api.opensubtitles.com" };
const USER_CONFIG = { username: "viewer", password: "hunter2" };
const OTHER_USER_CONFIG = { username: "other", password: "swordfish" };
const FAILURE_TTL = 200;

const load = (overrides = {}, configOverrides = {}) => {
  const client = {
    login: sinon.stub().resolves(SESSION),
    requestDownloadLink: sinon.stub().resolves("https://dl/sub.srt"),
    fetchSubtitleFile: sinon.stub().resolves(SRT),
    forgetSession: sinon.spy(),
    ...overrides,
  };
  const logger = { info: sinon.spy(), debug: sinon.spy(), error: sinon.spy() };

  // A fresh cache per test, or one test's download would be served to the next.
  const subtitleFileCache = proxyquire("../../../common/subtitleFileCache", {
    config: {
      get: (key) =>
        ({
          "subtitleFileCache.maxBytes": 33554432,
          "subtitleFileCache.ttlMs": 21600000,
          ...configOverrides,
        }[key]),
    },
    "./logger": { debug: sinon.spy() },
  });

  const downloadFailureCache = proxyquire(
    "../../../common/downloadFailureCache",
    {
      config: {
        get: (key) =>
          ({
            "downloadFailureCache.maxEntries": 500,
            "downloadFailureCache.ttlMs": FAILURE_TTL,
            ...configOverrides,
          }[key]),
      },
      "./logger": { debug: sinon.spy() },
    }
  );

  const { downloadSubtitle } = proxyquire("../../../routes/downloadSubtitle", {
    "../clients/openSubtitles": client,
    "../common/subtitleFileCache": subtitleFileCache,
    "../common/downloadFailureCache": downloadFailureCache,
    "../common/logger": logger,
  });

  return { downloadSubtitle, client, logger };
};

const makeRes = () => ({
  set: sinon.spy(),
  setHeader: sinon.spy(),
  end: sinon.spy(),
  status: sinon.stub().returnsThis(),
  send: sinon.spy(),
});

const req = { params: { fileId: "111" }, userConfig: USER_CONFIG };

const headerSetTo = (res, name) => {
  const call = [...res.set.getCalls(), ...res.setHeader.getCalls()]
    .reverse()
    .find((c) => c.args[0].toLowerCase() === name.toLowerCase());
  return call?.args[1];
};

describe("downloadSubtitle", function () {
  it("should serve the subtitle as a utf-8 buffer", async function () {
    const { downloadSubtitle } = load();
    const res = makeRes();

    await downloadSubtitle(req, res);

    const [buffer] = res.send.firstCall.args;
    assert.ok(Buffer.isBuffer(buffer));
    assert.strictEqual(buffer.toString("utf8"), SRT);
    assert.ok(
      res.setHeader.calledWith(
        "Content-Type",
        "application/x-subrip; charset=utf-8"
      )
    );
  });

  it("should fingerprint the response with the file id", async function () {
    const { downloadSubtitle } = load();
    const res = makeRes();

    await downloadSubtitle(req, res);

    assert.ok(res.set.calledWith("ETag", '"os-111"'));
    assert.match(headerSetTo(res, "Cache-Control"), /max-age=\d+/);
  });

  it("should answer 304 without asking OpenSubtitles when the client has it", async function () {
    // The contents never change for a file id, so a client holding it needs
    // nothing fetched: no download, no wait, no call at all.
    const { downloadSubtitle, client } = load();
    const res = makeRes();

    await downloadSubtitle({ ...req, fresh: true }, res);

    assert.ok(res.status.calledWith(304));
    assert.ok(client.login.notCalled, "A 304 must not reach OpenSubtitles");
    assert.ok(client.requestDownloadLink.notCalled);
    assert.ok(res.send.notCalled, "A 304 carries no body");
  });

  it("should spend the download against the requesting user's account", async function () {
    const { downloadSubtitle, client } = load();

    await downloadSubtitle(req, makeRes());

    assert.deepStrictEqual(client.login.firstCall.args[0], USER_CONFIG);
    assert.deepStrictEqual(client.requestDownloadLink.firstCall.args, [
      "111",
      SESSION,
    ]);
  });

  it("should reject a response that is not a subtitle, uncacheably", async function () {
    const { downloadSubtitle } = load({
      fetchSubtitleFile: sinon.stub().resolves("<html>nope</html>"),
    });
    const res = makeRes();

    await downloadSubtitle(req, res);

    assert.strictEqual(headerSetTo(res, "Cache-Control"), "no-store");
    assert.ok(res.status.calledWith(502));
    // The error path sends a message, so the check is that no body was served,
    // not that nothing was sent at all.
    const sent = res.send.firstCall?.args[0];
    assert.ok(
      !Buffer.isBuffer(sent),
      "Invalid content must never be served as a subtitle"
    );
  });

  it("should tell an unusable answer apart by its code, not its wording", async function () {
    // The branch used to match the phrase "valid SRT" in the message, so
    // rewording it moved an unusable answer to the generic failure quietly.
    const { downloadSubtitle, logger } = load({
      fetchSubtitleFile: sinon.stub().resolves("<html>nope</html>"),
    });

    await downloadSubtitle(req, makeRes());

    const [err, meta] = logger.error.firstCall.args;
    assert.strictEqual(err.code, "INVALID_SRT");
    assert.strictEqual(
      meta.description,
      "OpenSubtitles did not return a valid SRT file.",
      "An unusable answer must not be reported as a failed download"
    );
  });

  it("should forget the session and answer 401 when the credentials are refused", async function () {
    const rejection = Object.assign(new Error("unauthorized"), {
      response: { status: 401 },
    });
    const { downloadSubtitle, client } = load({
      login: sinon.stub().rejects(rejection),
    });
    const res = makeRes();

    await downloadSubtitle(req, res);

    assert.deepStrictEqual(client.forgetSession.firstCall.args[0], USER_CONFIG);
    assert.ok(res.status.calledWith(401));
  });

  it("should answer 429 when the daily quota is used up", async function () {
    const rejection = Object.assign(new Error("no quota"), {
      response: { status: 406 },
    });
    const { downloadSubtitle } = load({
      requestDownloadLink: sinon.stub().rejects(rejection),
    });
    const res = makeRes();

    await downloadSubtitle(req, res);

    assert.ok(res.status.calledWith(429));
    assert.strictEqual(headerSetTo(res, "Cache-Control"), "no-store");
  });

  it("should never log the subtitle's contents", async function () {
    const { downloadSubtitle, logger } = load();

    await downloadSubtitle(req, makeRes());

    const logged = JSON.stringify([
      logger.info.args,
      logger.debug.args,
      logger.error.args,
    ]);
    for (const line of ["שלום עולם", "-->"]) {
      assert.ok(!logged.includes(line), `Subtitle content leaked: ${line}`);
    }
  });

  it("should never log the user's password", async function () {
    const { downloadSubtitle, logger } = load();

    await downloadSubtitle(req, makeRes());

    const logged = JSON.stringify([
      logger.info.args,
      logger.debug.args,
      logger.error.args,
    ]);
    assert.ok(!logged.includes("hunter2"), `Password leaked: ${logged}`);
  });
});

const quotaSpent = () =>
  Object.assign(new Error("no quota"), { response: { status: 406 } });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Measured from a phone: a subtitle that fails is asked for around sixteen
// times in three seconds. The file cache keeps no failed download, correctly,
// which left every one of those retries spending another call on OpenSubtitles.
describe("downloadSubtitle after a failed download", function () {
  it("should stop asking OpenSubtitles once a download has failed", async function () {
    const { downloadSubtitle, client } = load({
      requestDownloadLink: sinon.stub().rejects(quotaSpent()),
    });

    await downloadSubtitle(req, makeRes());
    const res = makeRes();
    await downloadSubtitle(req, res);

    assert.strictEqual(
      client.requestDownloadLink.callCount,
      1,
      "The retry must be answered without OpenSubtitles"
    );
    assert.ok(res.status.calledWith(429), "The retry gets the same answer");
    assert.strictEqual(headerSetTo(res, "Cache-Control"), "no-store");
  });

  it("should leave another account's quota alone", async function () {
    // Keyed on the file id alone, the first user to run out of downloads would
    // refuse that subtitle to everyone else who still has quota.
    const requestDownloadLink = sinon.stub();
    requestDownloadLink.onFirstCall().rejects(quotaSpent());
    requestDownloadLink.onSecondCall().resolves("https://dl/sub.srt");
    const { downloadSubtitle, client } = load({ requestDownloadLink });

    await downloadSubtitle(req, makeRes());
    const res = makeRes();
    await downloadSubtitle({ ...req, userConfig: OTHER_USER_CONFIG }, res);

    assert.strictEqual(client.requestDownloadLink.callCount, 2);
    assert.ok(
      Buffer.isBuffer(res.send.firstCall.args[0]),
      "A user with quota left must still get the subtitle"
    );
  });

  it("should serve a file that has since been downloaded successfully", async function () {
    // The memory is consulted only when the file cache misses, so a subtitle
    // someone else has fetched in the meantime is served rather than refused.
    const requestDownloadLink = sinon.stub();
    requestDownloadLink.onFirstCall().rejects(quotaSpent());
    requestDownloadLink.onSecondCall().resolves("https://dl/sub.srt");
    const { downloadSubtitle, client } = load({ requestDownloadLink });

    await downloadSubtitle(req, makeRes());
    await downloadSubtitle(
      { ...req, userConfig: OTHER_USER_CONFIG },
      makeRes()
    );
    const res = makeRes();
    await downloadSubtitle(req, res);

    assert.strictEqual(client.requestDownloadLink.callCount, 2);
    const [buffer] = res.send.firstCall.args;
    assert.ok(Buffer.isBuffer(buffer), "A cached file is not a failure");
    assert.strictEqual(buffer.toString("utf8"), SRT);
  });

  it("should forget a failure the moment the file is served", async function () {
    // The cache is sized so the fourth request evicts the file, which puts the
    // last request back on the download path: a failure remembered past the
    // success that followed it would refuse a file known to work.
    const requestDownloadLink = sinon.stub().resolves("https://dl/sub.srt");
    requestDownloadLink.onFirstCall().rejects(quotaSpent());
    const { downloadSubtitle } = load(
      { requestDownloadLink },
      { "subtitleFileCache.maxBytes": Buffer.byteLength(SRT) + 10 }
    );

    await downloadSubtitle(req, makeRes());
    await downloadSubtitle(
      { ...req, userConfig: OTHER_USER_CONFIG },
      makeRes()
    );
    await downloadSubtitle(req, makeRes());
    await downloadSubtitle({ ...req, params: { fileId: "222" } }, makeRes());
    const res = makeRes();
    await downloadSubtitle(req, res);

    const [buffer] = res.send.firstCall.args;
    assert.ok(Buffer.isBuffer(buffer), "The file works and must be served");
    assert.strictEqual(buffer.toString("utf8"), SRT);
  });

  it("should try again once the memory of the failure expires", async function () {
    // A subtitle that failed once must not stay unavailable: the memory is
    // there to absorb a burst of retries, not to take the file away.
    const requestDownloadLink = sinon.stub();
    requestDownloadLink.onFirstCall().rejects(quotaSpent());
    requestDownloadLink.onSecondCall().resolves("https://dl/sub.srt");
    const { downloadSubtitle, client } = load({ requestDownloadLink });

    await downloadSubtitle(req, makeRes());
    await sleep(FAILURE_TTL * 2);
    const res = makeRes();
    await downloadSubtitle(req, res);

    assert.strictEqual(client.requestDownloadLink.callCount, 2);
    assert.strictEqual(res.send.firstCall.args[0].toString("utf8"), SRT);
  });
});
