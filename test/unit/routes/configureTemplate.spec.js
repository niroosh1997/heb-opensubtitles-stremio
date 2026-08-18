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
