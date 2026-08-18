const assert = require("assert");
const proxyquire = require("proxyquire").noCallThru();

const load = (values) =>
  proxyquire("../../../common/addonUrl", {
    config: { get: (key) => values[key] },
  });

describe("addonBaseUrl", function () {
  it("should leave the port out when served over https", function () {
    // Anything on https sits behind a tls terminator on the standard port, so a
    // port here gives Stremio something it cannot reach: subtitles list fine and
    // then never download.
    const { addonBaseUrl } = load({
      ssl: true,
      HOSTNAME: "addon.example.com",
      PORT: 3000,
    });

    assert.strictEqual(addonBaseUrl(), "https://addon.example.com");
  });

  it("should keep the port for local http development", function () {
    const { addonBaseUrl } = load({
      ssl: false,
      HOSTNAME: "localhost",
      PORT: 3000,
    });

    assert.strictEqual(addonBaseUrl(), "http://localhost:3000");
  });
});
