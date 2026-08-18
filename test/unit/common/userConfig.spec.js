const assert = require("assert");
const { encode, decode, redact } = require("../../../common/userConfig");

const CREDENTIALS = { username: "viewer", password: "hunter2" };

describe("userConfig", function () {
  it("should round trip the credentials through a url segment", function () {
    assert.deepStrictEqual(decode(encode(CREDENTIALS)), CREDENTIALS);
  });

  it("should produce a segment that is safe in a url path", function () {
    const segment = encode({ username: "a+b/c", password: "p=?&#" });

    assert.strictEqual(
      segment,
      encodeURIComponent(segment),
      "The segment must survive being put in a path unencoded"
    );
  });

  it("should keep only the credentials, whatever else was encoded", function () {
    const segment = encode({ ...CREDENTIALS, admin: true });

    assert.deepStrictEqual(Object.keys(decode(segment)), [
      "username",
      "password",
    ]);
  });

  it("should reject a configuration that is missing a field", function () {
    assert.throws(() => decode(encode({ username: "viewer" })), /password/);
    assert.throws(() => decode(encode({ password: "hunter2" })), /username/);
  });

  it("should reject a segment that is not a configuration at all", function () {
    assert.throws(() => decode("not-base64-json"));
  });
});

describe("userConfig redact", function () {
  const segment = encode(CREDENTIALS);

  it("should keep the password out of a subtitles url", function () {
    const url = `/${segment}/subtitles/series/tt0903747:2:5/filename=x.json`;

    const safe = redact(url);

    assert.ok(!safe.includes("hunter2"), `Password leaked: ${safe}`);
    assert.ok(!safe.includes(segment), `Config leaked: ${safe}`);
    assert.strictEqual(
      safe,
      "/<config>/subtitles/series/tt0903747:2:5/filename=x.json"
    );
  });

  it("should keep the password out of a subtitle download url", function () {
    const safe = redact(`/${segment}/srt/111.srt`);

    assert.strictEqual(safe, "/<config>/srt/111.srt");
  });

  it("should leave the unconfigured routes alone", function () {
    for (const url of [
      "/manifest.json",
      "/configure",
      "/verify",
      "/README.md",
      "/",
    ]) {
      assert.strictEqual(redact(url), url);
    }
  });

  it("should keep the query string", function () {
    const safe = redact(`/${segment}/srt/111.srt?x=1`);

    assert.strictEqual(safe, "/<config>/srt/111.srt?x=1");
  });
});
