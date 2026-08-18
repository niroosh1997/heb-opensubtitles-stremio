const assert = require("assert");
const sinon = require("sinon");
const proxyquire = require("proxyquire").noCallThru();

const CREDENTIALS = { username: "viewer", password: "hunter2" };

const LOGIN_RESPONSE = {
  data: {
    token: "jwt-token",
    base_url: "api.opensubtitles.com",
    user: { allowed_downloads: 20, vip: false },
  },
};

const SEARCH_RESPONSE = {
  data: {
    data: [
      {
        attributes: {
          release: "Breaking.Bad.S02E05.1080p.WEB-DL",
          language: "he",
          files: [{ file_id: 111, file_name: "breaking.bad.s02e05.he.srt" }],
        },
      },
      {
        attributes: {
          release: "Breaking.Bad.S02E05.720p.HDTV",
          language: "he",
          files: [
            { file_id: 222, file_name: "part1.srt" },
            { file_id: 333, file_name: "part2.srt" },
          ],
        },
      },
    ],
  },
};

const loadClient = () => {
  const instance = {
    get: sinon.stub().resolves(SEARCH_RESPONSE),
    post: sinon.stub().resolves(LOGIN_RESPONSE),
    interceptors: { response: { use: sinon.spy() } },
  };
  const axios = {
    create: sinon.stub().returns(instance),
    get: sinon
      .stub()
      .resolves({ data: "1\n00:00:01,000 --> 00:00:04,000\nshalom\n" }),
  };

  const client = proxyquire("../../../clients/openSubtitles", {
    axios,
    config: {
      get: (key) =>
        ({
          "openSubtitles.apiKey": "test-api-key",
          "openSubtitles.host": "api.opensubtitles.com",
          "openSubtitles.timeoutMs": 10000,
          "openSubtitles.maxSessions": 500,
          "openSubtitles.sessionTtlMs": 82800000,
        }[key]),
    },
    "../common/logger": {
      info: sinon.spy(),
      debug: sinon.spy(),
      error: sinon.spy(),
    },
  });

  return { client, axios, instance };
};

describe("openSubtitles login", function () {
  it("should post the credentials to the login endpoint", async function () {
    const { client, instance } = loadClient();

    await client.login(CREDENTIALS);

    const [path, body] = instance.post.firstCall.args;
    assert.strictEqual(path, "/login");
    assert.deepStrictEqual(body, {
      username: "viewer",
      password: "hunter2",
    });
  });

  it("should send the api key and a user agent on every request", async function () {
    const { client, axios } = loadClient();

    await client.login(CREDENTIALS);

    const { headers } = axios.create.firstCall.args[0];
    assert.strictEqual(headers["Api-Key"], "test-api-key");
    assert.ok(headers["User-Agent"], "A user agent is required by the API");
  });

  it("should ask for json explicitly, or the edge blocks the request", async function () {
    // Axios defaults to "application/json, text/plain, */*", which
    // OpenSubtitles answers with a 503 html page rather than the api's json.
    const { client, axios } = loadClient();

    await client.login(CREDENTIALS);

    const { headers } = axios.create.firstCall.args[0];
    assert.strictEqual(headers.Accept, "application/json");
  });

  it("should reuse the session instead of logging in again", async function () {
    const { client, instance } = loadClient();

    await client.login(CREDENTIALS);
    await client.login(CREDENTIALS);

    assert.strictEqual(
      instance.post.callCount,
      1,
      "Logging in is rate limited to 30 per hour, so it must be cached"
    );
  });

  it("should log in again once the session is forgotten", async function () {
    const { client, instance } = loadClient();

    await client.login(CREDENTIALS);
    client.forgetSession(CREDENTIALS.username);
    await client.login(CREDENTIALS);

    assert.strictEqual(instance.post.callCount, 2);
  });

  it("should follow the host the login handed back", async function () {
    const { client, axios, instance } = loadClient();
    instance.post.resolves({
      data: { ...LOGIN_RESPONSE.data, base_url: "vip-api.opensubtitles.com" },
    });

    const session = await client.login(CREDENTIALS);
    await client.search({ imdbID: "tt9407490", languages: "he" }, session);

    const hosts = axios.create.getCalls().map((call) => call.args[0].baseURL);
    assert.ok(
      hosts.includes("https://vip-api.opensubtitles.com/api/v1"),
      `Expected the vip host to be used, got: ${hosts.join(", ")}`
    );
  });
});

describe("openSubtitles search", function () {
  it("should send the imdb id as a number without its tt prefix or leading zeroes", async function () {
    const { client, instance } = loadClient();

    await client.search({ imdbID: "tt0111161", languages: "he" });

    const { params } = instance.get.firstCall.args[1];
    assert.strictEqual(params.imdb_id, 111161);
  });

  it("should search an episode by its parent id, season and episode", async function () {
    const { client, instance } = loadClient();

    await client.search(
      { imdbID: "tt0903747", season: "2", episode: "5", languages: "he" },
      undefined
    );

    const { params } = instance.get.firstCall.args[1];
    assert.strictEqual(params.parent_imdb_id, 903747);
    assert.strictEqual(params.season_number, 2);
    assert.strictEqual(params.episode_number, 5);
    assert.strictEqual(
      params.imdb_id,
      undefined,
      "An episode is searched by its parent id, not its own"
    );
  });

  it("should send the parameters sorted, as the api asks", async function () {
    const { client, instance } = loadClient();

    await client.search(
      { imdbID: "tt0903747", season: "2", episode: "5", languages: "he" },
      undefined
    );

    const keys = Object.keys(instance.get.firstCall.args[1].params);
    assert.deepStrictEqual(keys, keys.slice().sort());
  });

  it("should flatten every file of every result", async function () {
    const { client } = loadClient();

    const subs = await client.search({ imdbID: "tt0903747", languages: "he" });

    assert.deepStrictEqual(
      subs.map((sub) => sub.fileId),
      [111, 222, 333],
      "A subtitle with two files should yield two entries"
    );
    assert.strictEqual(subs[0].fileName, "breaking.bad.s02e05.he.srt");
    assert.strictEqual(subs[0].release, "Breaking.Bad.S02E05.1080p.WEB-DL");
    assert.strictEqual(subs[0].language, "he");
  });

  it("should return an empty list when there are no results", async function () {
    const { client, instance } = loadClient();
    instance.get.resolves({ data: {} });

    const subs = await client.search({ imdbID: "tt0903747", languages: "he" });

    assert.deepStrictEqual(subs, []);
  });
});

describe("openSubtitles download", function () {
  it("should request the link with the file id and the user's token", async function () {
    const { client, instance } = loadClient();
    const session = await client.login(CREDENTIALS);
    instance.post.resolves({
      data: { link: "https://dl/sub.srt", remaining: 19 },
    });

    const link = await client.requestDownloadLink("111", session);

    const [path, body, options] = instance.post.lastCall.args;
    assert.strictEqual(path, "/download");
    assert.deepStrictEqual(body, { file_id: 111 });
    assert.strictEqual(options.headers.Authorization, "Bearer jwt-token");
    assert.strictEqual(link, "https://dl/sub.srt");
  });

  it("should fetch the subtitle from the temporary link", async function () {
    const { client, axios } = loadClient();

    const content = await client.fetchSubtitleFile("https://dl/sub.srt");

    assert.strictEqual(axios.get.firstCall.args[0], "https://dl/sub.srt");
    assert.ok(content.includes("-->"), "Should return the subtitle content");
  });
});
