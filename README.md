# Hebrew OpenSubtitles Stremio Addon

An unofficial [Stremio](http://strem.io/) addon that adds Hebrew subtitles from
[OpenSubtitles](https://www.opensubtitles.com/) to media streamed by Stremio.

> **Status:** the OpenSubtitles client is not written yet. The addon currently
> still fetches from Ktuvit.me, inherited from the project this is based on.
> Everything around it, the routes, caching, logging and CI, is provider
> agnostic and already in place.

**DISCLAIMER**: I am not affiliated with nor a part of OpenSubtitles. Any problems,
issues, and attacks on the service or the content they provide should be addressed
to them.

## Credits

This project began as a copy of [maormagori/ktuvit-stremio](https://github.com/maormagori/ktuvit-stremio)
by Maor Magori, and keeps its full commit history. The addon's structure, the
Stremio protocol handling and the SRT proxying are all his work, used here under
the MIT licence. If you want Ktuvit subtitles specifically, use his addon rather
than this one.

## Development

Before diving in, get familiar with [Stremio's Addon Protocol](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md).
Otherwise things will not make much sense.

This addon is an [express](https://github.com/expressjs/express) server running on
Node. The test tooling requires Node 18.18 or newer.

```bash
git clone https://github.com/niroosh1997/heb-opensubtitles-stremio.git
cd heb-opensubtitles-stremio
npm install
```

Set the required environment variables, either by exporting them or with a `.env`
file. These are still the Ktuvit ones and will be replaced when the OpenSubtitles
client lands:

```
KTUVIT_USER_EMAIL=your.ktuvit.user.email.address
KTUVIT_USER_HASHED_PASSWORD=your.ktuvit.user.hashed.password
```

Then run:

```bash
npm run start

# Alternatively with nodemon
npm run devStart
```

and the addon will be available on: `http://localhost:3000/`

```bash
npm test      # unit and e2e tests
npm run lint  # eslint and prettier
npm run fix   # fix what can be fixed automatically
```

#### Additional environment variables

You can also add these env variables to alter the way the addon behaves:
```bash
AUTHOR_EMAIL  # The email displayed in the addon's manifest
PORT   # The port the addon listens on. defaults to 3000
LOG_LEVEL   # The minimum winston level to log. defaults to http
SUBS_CACHE_MAX_ENTRIES    # How many titles to keep cached. defaults to 500
SUBS_CACHE_FOUND_TTL_MS   # How long to keep a subtitles list. defaults to 3600000 (1 hour)
SUBS_CACHE_EMPTY_TTL_MS   # How long to keep an empty result. defaults to 300000 (5 minutes)
```

#### Logging

Requests are logged by [morgan](https://github.com/expressjs/morgan) at the `http`
level, and every call to the subtitles provider logs its arguments at the `info`
level. Response bodies are never logged, so a subtitle request shows up as the
request itself plus its status, never the contents of the SRT file.

`LOG_LEVEL` controls how much of this you see:

| `LOG_LEVEL` | What you get |
| --- | --- |
| `info` | Provider calls and errors, no request logs |
| `http` (default) | The above, plus a line per request |
| `debug` | The above, plus the results of each provider call |

#### Caching

Stremio appends the video's filename, hash and size to every subtitles request,
so no two viewers of the same episode send the same URL and route based caching
never helps. The addon therefore caches subtitles lists itself, keyed on the
title rather than the URL: every release of one episode shares a single entry
and each request is still sorted against its own filename.

An empty result is kept only briefly, since it usually means the subtitles are
not up yet rather than that the title will never have any. Failed requests are
never cached. The cache is per process, so it starts empty after a restart.

# Contributing

PRs are welcome. Take a look at the open [issues](https://github.com/niroosh1997/heb-opensubtitles-stremio/issues)
to see where you can help, and open one if you hit a problem.

# License

[MIT](https://github.com/niroosh1997/heb-opensubtitles-stremio/blob/main/LICENSE),
inherited from the original project. The original copyright notice is kept intact.
