const assert = require("assert");
const http = require("http");
const express = require("express");
const { httpLogger } = require("../../common/httpLogger");

const SUBTITLE_TEXT = "SECRET_SUBTITLE_TEXT";
const CONFIG_SEGMENT = require("../../common/userConfig").encode({
  username: "viewer",
  password: "SECRET_PASSWORD",
});
const SRT_PAYLOAD = `1\n00:00:01,000 --> 00:00:04,000\n${SUBTITLE_TEXT}\n`;

// Replaces process.stdout.write so the assertions run against the line winston
// actually renders, rather than against the format string or a re-formatted
// copy of it.
const captureStdout = () => {
  const chunks = [];
  const original = process.stdout.write.bind(process.stdout);

  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };

  return { chunks, restore: () => (process.stdout.write = original) };
};

describe("request logging", function () {
  let server;

  beforeEach(function (done) {
    const addon = express();
    addon.use(httpLogger);

    addon.get("/manifest.json", (req, res) =>
      res.send({ id: "heb.stremio.opensubtitles" })
    );
    addon.get("/:userConfig/srt/:fileId.srt", (req, res) => {
      res.setHeader("Content-Type", "application/x-subrip; charset=utf-8");
      res.end(Buffer.from(SRT_PAYLOAD));
    });

    server = addon.listen(0, done);
  });

  afterEach(function (done) {
    server.close(done);
  });

  const get = (path, headers) =>
    new Promise((resolve, reject) => {
      const req = http.get(
        // agent: false keeps the socket from being pooled. Node 19 turned
        // keep-alive on by default, and a pooled socket would leave
        // server.close() waiting until the afterEach hook times out.
        { port: server.address().port, path, headers, agent: false },
        (res) => {
          res.on("data", () => {});
          res.on("end", resolve);
        }
      );
      req.on("error", reject);
    });

  const logOutputFor = async (path, headers) => {
    const capture = captureStdout();

    try {
      await get(path, headers);
    } finally {
      capture.restore();
    }

    return capture.chunks;
  };

  it("should log the method, url, status, response size and duration", async function () {
    const [line] = await logOutputFor("/manifest.json");

    assert.match(
      line,
      /\[http\]: GET \/manifest\.json 200 \d+ - [\d.]+ ms/,
      `Unexpected log line: ${JSON.stringify(line)}`
    );
  });

  it("should log one line per request, with no stray blank line", async function () {
    const chunks = await logOutputFor("/manifest.json");

    assert.strictEqual(
      chunks.length,
      1,
      `Expected one write, got: ${JSON.stringify(chunks)}`
    );
    assert.strictEqual(
      chunks[0].match(/\n/g).length,
      1,
      `Expected a single newline, got: ${JSON.stringify(chunks[0])}`
    );
  });

  it("should log an SRT request without any of the subtitle's content", async function () {
    const [line] = await logOutputFor(`/${CONFIG_SEGMENT}/srt/111.srt`);

    assert.match(
      line,
      /\[http\]: GET \/<config>\/srt\/111\.srt 200 (\d+|-) - [\d.]+ ms/
    );

    for (const payloadFragment of [SUBTITLE_TEXT, "00:00:01,000", "-->"]) {
      assert.ok(
        !line.includes(payloadFragment),
        `Subtitle content should never be logged, found ${payloadFragment} in: ${line}`
      );
    }
  });

  it("should not log the client's address or user agent", async function () {
    const userAgent = "StremioSniffer/9.9";
    const [line] = await logOutputFor("/manifest.json", {
      "User-Agent": userAgent,
    });

    assert.ok(
      !line.includes(userAgent),
      `User agent should not be logged, got: ${line}`
    );
    assert.ok(
      !line.includes("127.0.0.1"),
      `Client address should not be logged, got: ${line}`
    );
  });

  it("should log requests that no route handled", async function () {
    const [line] = await logOutputFor("/not-a-route");

    // An unrecognised first segment is redacted rather than logged, because a
    // user landing on their own configured url with nothing after it would
    // otherwise put their password in the log. The cost is that 404s for
    // unknown paths are recorded without the path.
    assert.match(line, /\[http\]: GET \/<config> 404/);
  });

  it("should keep the user's password out of the log", async function () {
    const [line] = await logOutputFor(`/${CONFIG_SEGMENT}/srt/111.srt`);

    assert.ok(!line.includes("SECRET_PASSWORD"), `Password leaked: ${line}`);
    assert.ok(!line.includes(CONFIG_SEGMENT), `Config leaked: ${line}`);
  });
});
