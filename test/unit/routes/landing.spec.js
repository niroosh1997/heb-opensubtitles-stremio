const assert = require("assert");
const sinon = require("sinon");
const proxyquire = require("proxyquire").noCallThru();

const load = () =>
  proxyquire("../../../routes/landing/landing", {
    "./configureTemplate": () => "<html>page</html>",
    "../manifest": {
      MANIFEST: { name: "X", description: "Y", version: "1.2.3" },
    },
    config: { get: () => 60 },
  });

describe("the configure page", function () {
  it("should not be cacheable for long", function () {
    // The page hands out the install link, and the link carries the version, so
    // a stale page installs a stale addon. Beamup holds anything without a
    // header of its own for four hours.
    const landing = load();
    const res = { type: sinon.spy(), set: sinon.spy(), send: sinon.spy() };

    landing({}, res);

    const [, value] = res.set
      .getCalls()
      .find((c) => c.args[0] === "Cache-Control").args;
    const maxAge = Number(value.match(/max-age=(\d+)/)[1]);
    assert.ok(maxAge <= 300, `Configure page cached too long: ${value}`);
  });

  it("should still serve the page", function () {
    const landing = load();
    const res = { type: sinon.spy(), set: sinon.spy(), send: sinon.spy() };

    landing({}, res);

    assert.ok(res.type.calledWith("html"));
    assert.ok(res.send.calledWith("<html>page</html>"));
  });
});
