const assert = require("assert");
const sinon = require("sinon");
const proxyquire = require("proxyquire").noCallThru();

const SRT = "1\n00:00:01,000 --> 00:00:04,000\nשלום עולם\n";
const SESSION = { token: "jwt", host: "api.opensubtitles.com" };
const USER_CONFIG = { username: "viewer", password: "hunter2" };

const load = (overrides = {}) => {
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
        }[key]),
    },
    "./logger": { debug: sinon.spy() },
  });

  const { downloadSubtitle } = proxyquire("../../../routes/downloadSubtitle", {
    "../clients/openSubtitles": client,
    "../common/subtitleFileCache": subtitleFileCache,
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
    // The rejection is shaped like the one their error codes page documents,
    // so the 406 in the route stays pinned to a real response rather than to
    // a bare number nobody can check.
    const rejection = Object.assign(new Error("no quota"), {
      response: {
        status: 406,
        data: {
          requests: 21,
          remaining: -1,
          message:
            "You have downloaded your allowed 20 subtitles for 24h.Your quota will be renewed in 23 hours and 57 minutes (2022-01-30 06:00:53 UTC) ",
          reset_time_utc: "2022-01-30T06:00:53.000Z",
        },
      },
    });
    const { downloadSubtitle } = load({
      requestDownloadLink: sinon.stub().rejects(rejection),
    });
    const res = makeRes();

    await downloadSubtitle(req, res);

    assert.ok(res.status.calledWith(429));
    assert.ok(
      !res.status.calledWith(502),
      "A spent quota must not read as a generic failure"
    );
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
