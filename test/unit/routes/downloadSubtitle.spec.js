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

  const { downloadSubtitle } = proxyquire("../../../routes/downloadSubtitle", {
    "../clients/openSubtitles": client,
    "../common/logger": logger,
  });

  return { downloadSubtitle, client, logger };
};

const makeRes = () => ({
  setHeader: sinon.spy(),
  end: sinon.spy(),
  status: sinon.stub().returnsThis(),
  send: sinon.spy(),
});

const req = { params: { fileId: "111" }, userConfig: USER_CONFIG };

describe("downloadSubtitle", function () {
  it("should serve the subtitle as a utf-8 buffer", async function () {
    const { downloadSubtitle } = load();
    const res = makeRes();

    await downloadSubtitle(req, res);

    const [buffer] = res.end.firstCall.args;
    assert.ok(Buffer.isBuffer(buffer));
    assert.strictEqual(buffer.toString("utf8"), SRT);
    assert.ok(
      res.setHeader.calledWith(
        "Content-Type",
        "application/x-subrip; charset=utf-8"
      )
    );
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

    assert.ok(res.setHeader.calledWith("Cache-Control", "no-store"));
    assert.ok(res.status.calledWith(502));
    assert.ok(res.end.notCalled, "Invalid content must never be served");
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
    assert.ok(res.setHeader.calledWith("Cache-Control", "no-store"));
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
