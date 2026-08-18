const assert = require("assert");
const configureTemplate = require("../../../routes/landing/configureTemplate");
const { decode } = require("../../../common/userConfig");

const MANIFEST = { name: "Hebrew OpenSubtitles", description: "Subtitles." };

describe("configureTemplate", function () {
  const page = configureTemplate(MANIFEST);

  it("should ask for the credentials the addon needs", function () {
    assert.ok(page.includes('id="username"'), "No username field");
    assert.ok(page.includes('id="password"'), "No password field");
    assert.ok(page.includes('type="password"'), "Password must be masked");
  });

  it("should load nothing from another host, so it cannot hang", function () {
    const external = page.match(/(?:src|href)="https?:\/\/[^"]+"/g) || [];

    assert.deepStrictEqual(
      external,
      [],
      `The page must be self contained, found: ${external.join(", ")}`
    );
  });

  it("should encode the config the same way the server decodes it", function () {
    // The page builds the segment in the browser; this is that algorithm,
    // checked against the decoder the routes actually use.
    const encodeInBrowser = (config) =>
      Buffer.from(JSON.stringify(config), "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    const credentials = { username: "viewer", password: "hunter2" };

    assert.deepStrictEqual(decode(encodeInBrowser(credentials)), credentials);
  });

  it("should warn that the link carries the credentials", function () {
    assert.match(page, /keep it to yourself/i);
  });
});

describe("manifest logo and contact", function () {
  const sinon = require("sinon");
  const proxyquire = require("proxyquire").noCallThru();

  const load = () =>
    proxyquire("../../../routes/manifest", {
      config: {
        get: (key) =>
          key === "manifestCacheMaxAgeSeconds" ? 300 : "niroosh1997@gmail.com",
      },
      "../common/addonUrl": { addonBaseUrl: () => "https://addon.example.com" },
    });

  it("should point the logo at the addon itself", function () {
    // Served by the addon so there is no third party left to take it down; the
    // project this was copied from hotlinked its logo from a wordpress cdn.
    const { serveManifest } = load();
    const res = { send: sinon.spy(), set: sinon.spy() };

    serveManifest({}, res);

    assert.strictEqual(
      res.send.firstCall.args[0].logo,
      "https://addon.example.com/logo.png"
    );
  });

  it("should carry a contact address that is not a placeholder", function () {
    const { serveManifest } = load();
    const res = { send: sinon.spy(), set: sinon.spy() };

    serveManifest({}, res);

    const { contactEmail } = res.send.firstCall.args[0];
    assert.ok(contactEmail.includes("@"));
    assert.ok(
      !/set\.me|example\.com/.test(contactEmail),
      `Placeholder shipped to every installer: ${contactEmail}`
    );
  });

  it("should not let the manifest be cached for hours", function () {
    // With no header of its own it inherited beamup's four hours, so a new
    // logo or contact address took that long to reach anyone.
    const { serveManifest } = load();
    const res = { send: sinon.spy(), set: sinon.spy() };

    serveManifest({}, res);

    const [, value] = res.set
      .getCalls()
      .find((c) => c.args[0] === "Cache-Control").args;
    const maxAge = Number(value.match(/max-age=(\d+)/)[1]);
    assert.ok(maxAge <= 900, `Manifest cached too long: ${value}`);
  });

  it("should carry the ownership signature on both manifests", function () {
    // stremio-addons.net reads this to show the addon as claimed. The
    // configured manifest is a copy of the unconfigured one, so it is worth
    // checking the copy did not drop it.
    const { serveManifest } = load();

    for (const req of [{}, { userConfig: { username: "viewer" } }]) {
      const res = { send: sinon.spy(), set: sinon.spy() };
      serveManifest(req, res);

      const { stremioAddonsConfig } = res.send.firstCall.args[0];
      assert.strictEqual(
        stremioAddonsConfig.issuer,
        "https://stremio-addons.net"
      );
      assert.ok(
        stremioAddonsConfig.signature.length > 50,
        "The signature must be carried whole"
      );
    }
  });
});
