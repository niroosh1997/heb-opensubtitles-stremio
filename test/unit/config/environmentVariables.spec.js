const assert = require("assert");
const mapping = require("../../../config/custom-environment-variables.json");

describe("environment variable mapping", function () {
  it("should not take the addon's hostname from HOSTNAME", function () {
    // Docker sets HOSTNAME in every container, to the container id. Reading the
    // addon's public hostname from it meant that forgetting to set it did not
    // fail: it quietly handed Stremio urls like https://8cf5a4801c42:5914,
    // which nothing can reach.
    assert.notStrictEqual(
      mapping.HOSTNAME,
      "HOSTNAME",
      "Pick a name a container runtime does not already define"
    );
  });

  it("should read the hostname from ADDON_HOSTNAME", function () {
    assert.strictEqual(mapping.HOSTNAME, "ADDON_HOSTNAME");
  });
});
