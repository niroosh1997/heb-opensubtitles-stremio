const assert = require("assert");
const config = require("config");
const logger = require("../../../common/logger");

describe("logger", function () {
  it("should take its level from the configuration", function () {
    assert.strictEqual(logger.level, config.get("logLevel"));
  });
});

describe("logger with awkward metadata", function () {
  const logger = require("../../../common/logger");

  // Captures what winston renders, since the crash happened inside the
  // formatter rather than at the call site.
  const captureOutput = (fn) => {
    const chunks = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
      chunks.push(String(chunk));
      return true;
    };

    try {
      fn();
    } finally {
      process.stdout.write = original;
    }

    return chunks.join("");
  };

  it("should log an axios style error without dying on its circular request", function () {
    // Axios hangs the request and socket off its errors, and they point back at
    // each other. JSON.stringify used to throw here and take the process down,
    // so any failed OpenSubtitles call crashed the addon.
    const request = { name: "ClientRequest" };
    const socket = { name: "TLSSocket", _httpMessage: request };
    request.socket = socket;

    const err = Object.assign(
      new Error("Request failed with status code 403"),
      {
        request,
      }
    );

    let output;
    assert.doesNotThrow(() => {
      output = captureOutput(() => logger.error(err, { fileId: "111" }));
    });

    assert.match(output, /403/);
    assert.match(output, /Circular/);
  });

  it("should still log plain metadata normally", function () {
    const output = captureOutput(() =>
      logger.info("Searching OpenSubtitles.", { imdb_id: 111161 })
    );

    assert.match(output, /"imdb_id":111161/);
  });
});
