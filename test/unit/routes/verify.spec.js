const assert = require("assert");
const sinon = require("sinon");
const proxyquire = require("proxyquire").noCallThru();

const CREDENTIALS = { username: "viewer", password: "hunter2" };

const load = (login) => {
  const logger = { info: sinon.spy(), debug: sinon.spy(), error: sinon.spy() };
  const { verifyCredentials } = proxyquire("../../../routes/verify", {
    "../clients/openSubtitles": { login },
    "../common/logger": logger,
  });
  return { verifyCredentials, logger };
};

const makeRes = () => ({
  status: sinon.stub().returnsThis(),
  send: sinon.spy(),
});

const rejectionWith = (status) =>
  Object.assign(new Error("nope"), { response: { status } });

describe("verifyCredentials", function () {
  it("should report the quota back when the login works", async function () {
    const { verifyCredentials } = load(
      sinon.stub().resolves({ allowedDownloads: 20, vip: false })
    );
    const res = makeRes();

    await verifyCredentials({ body: CREDENTIALS }, res);

    assert.deepStrictEqual(res.send.firstCall.args[0], {
      ok: true,
      allowedDownloads: 20,
      vip: false,
    });
  });

  it("should answer 401 with a readable message when they are refused", async function () {
    const { verifyCredentials } = load(
      sinon.stub().rejects(rejectionWith(401))
    );
    const res = makeRes();

    await verifyCredentials({ body: CREDENTIALS }, res);

    assert.ok(res.status.calledWith(401));
    assert.match(res.send.firstCall.args[0].error, /did not accept/i);
  });

  it("should separate a refusal from OpenSubtitles being unreachable", async function () {
    const { verifyCredentials } = load(
      sinon.stub().rejects(rejectionWith(503))
    );
    const res = makeRes();

    await verifyCredentials({ body: CREDENTIALS }, res);

    assert.ok(res.status.calledWith(502));
    assert.match(res.send.firstCall.args[0].error, /could not reach/i);
  });

  it("should ask for both fields before calling OpenSubtitles", async function () {
    const login = sinon.stub().resolves({});
    const { verifyCredentials } = load(login);
    const res = makeRes();

    await verifyCredentials({ body: { username: "viewer" } }, res);

    assert.ok(res.status.calledWith(400));
    assert.ok(
      login.notCalled,
      "No point asking OpenSubtitles about half a login"
    );
  });

  it("should never log the password", async function () {
    const { verifyCredentials, logger } = load(
      sinon.stub().rejects(rejectionWith(503))
    );

    await verifyCredentials({ body: CREDENTIALS }, makeRes());

    const logged = JSON.stringify([
      logger.info.args,
      logger.debug.args,
      logger.error.args,
    ]);
    assert.ok(!logged.includes("hunter2"), `Password leaked: ${logged}`);
  });
});
