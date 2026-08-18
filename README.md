# Hebrew OpenSubtitles Stremio Addon

An unofficial [Stremio](http://strem.io/) addon that adds Hebrew subtitles from
[OpenSubtitles](https://www.opensubtitles.com/) to media streamed by Stremio.

**DISCLAIMER**: I am not affiliated with nor a part of OpenSubtitles. Any problems,
issues, and attacks on the service or the content they provide should be addressed
to them.

## Each user signs in with their own account

OpenSubtitles meters downloads per account: 20 a day on a free account, 1000 on a
VIP one. A single shared account would give the whole addon 20 downloads a day
between everyone, so instead every user configures the addon with their own
OpenSubtitles login and spends their own quota.

Searching for subtitles is not metered, only downloading them, and the download
is spent when Stremio asks for the file rather than when the list is shown.

> **Your credentials live in your addon URL.** That is how Stremio passes
> configuration to an addon, and it is why the install link is personal: anyone you
> share it with can use your quota. The addon never writes it to its logs, but do
> not paste your addon URL anywhere public.

## Credits

This project began as a copy of [maormagori/ktuvit-stremio](https://github.com/maormagori/ktuvit-stremio)
by Maor Magori, and keeps its full commit history. The addon's structure, the
Stremio protocol handling and the subtitle proxying are all his work, used here
under the MIT licence. His addon serves Ktuvit.me subtitles if that is what you
are after.

## Development

Before diving in, get familiar with [Stremio's Addon Protocol](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md)
and the [OpenSubtitles REST API](https://opensubtitles.stoplight.io/docs/opensubtitles-api).

This addon is an [express](https://github.com/expressjs/express) server running on
Node. The test tooling requires Node 18.18 or newer.

```bash
git clone https://github.com/niroosh1997/heb-opensubtitles-stremio.git
cd heb-opensubtitles-stremio
npm install
```

You need an OpenSubtitles API key, which identifies this addon to them and is free
to request as a [consumer](https://www.opensubtitles.com/en/consumers). It is not
the same thing as a user login: the key identifies the app, each user's own
username and password carry their download quota.

```
OPENSUBTITLES_API_KEY=your.api.key
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

```bash
AUTHOR_EMAIL   # The email displayed in the addon's manifest
PORT           # The port the addon listens on. defaults to 3000
LOG_LEVEL      # The minimum winston level to log. defaults to http
OPENSUBTITLES_HOST            # defaults to api.opensubtitles.com
OPENSUBTITLES_LANGUAGES       # languages to search for. defaults to he
OPENSUBTITLES_TIMEOUT_MS      # defaults to 10000
OPENSUBTITLES_MAX_SESSIONS    # how many user sessions to keep. defaults to 500
OPENSUBTITLES_SESSION_TTL_MS  # how long a session lasts. defaults to 23 hours
SUBS_CACHE_MAX_ENTRIES        # How many titles to keep cached. defaults to 500
SUBS_CACHE_FOUND_TTL_MS       # How long to keep a subtitles list. defaults to 1 hour
SUBS_CACHE_EMPTY_TTL_MS       # How long to keep an empty result. defaults to 5 minutes
DOWNLOAD_FAILURE_CACHE_TTL_MS      # How long a failed download is remembered. defaults to 30 seconds
DOWNLOAD_FAILURE_CACHE_MAX_ENTRIES # How many failed downloads to remember. defaults to 500
```

#### Sessions

Logging in to OpenSubtitles is rate limited to 30 times an hour, so a login is
exchanged for a token once and kept for as long as it is useful, keyed on the
username. A token rejected with a 401 is dropped immediately rather than reused
until it expires.

#### Logging

Requests are logged by [morgan](https://github.com/expressjs/morgan) at the `http`
level, and every call to OpenSubtitles logs its arguments at the `info` level.
Response bodies are never logged, and neither is the configuration segment of the
url, which holds the user's password. Anything unrecognised in that position is
redacted rather than logged, so a 404 for an unknown path is recorded without the
path.

`LOG_LEVEL` controls how much of this you see:

| `LOG_LEVEL` | What you get |
| --- | --- |
| `info` | OpenSubtitles calls and errors, no request logs |
| `http` (default) | The above, plus a line per request |
| `debug` | The above, plus the results of each call |

#### Caching

Stremio appends the video's filename, hash and size to every subtitles request,
so no two viewers of the same episode send the same URL and route based caching
never helps. The addon therefore caches subtitles lists itself, keyed on the
title and language rather than the URL: every release of one episode shares a
single entry and each request is still sorted against its own filename.

The list is the same whoever asks for it, so one entry serves every user. Only
downloading is per user, and downloads are never cached.

An empty result is kept only briefly, since it usually means the subtitles are
not up yet rather than that the title will never have any. Failed requests are
never cached. The cache is per process, so it starts empty after a restart.

A failed download is the one thing worth remembering about a failure. Stremio
asks for a subtitle that would not load around sixteen times in three seconds,
and since a downloaded file is never cached when it fails, each of those retries
used to spend another call on OpenSubtitles. The fact that a download failed, and
the status it failed with, is therefore kept for thirty seconds and the retries
are answered from that. Never the response body: a bad answer cached is a bad
answer served. It is remembered per account as well as per file, so a quota that
has run out refuses that user and nobody else, and it is dropped the moment the
file is served successfully.

## Deploying

The addon deploys to [BeamUp](https://github.com/Stremio/beamup), Stremio's free
hosting, on every push to `main`. Before the workflow can work you need to create
the app and tell the repo about it:

1. Install the CLI and register: `npm i -g beamup-cli`, then `beamup`. It uploads
   your public SSH key and creates the app, printing a git remote and a hostname
   like `<hash>-heb-opensubtitles-stremio.baby-beamup.club`.
2. Add to the repository, under Settings then Secrets and variables then Actions:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `SSH_PRIVATE_KEY` | the private key matching the one BeamUp registered |
| Secret | `OPENSUBTITLES_API_KEY` | your OpenSubtitles consumer API key |
| Variable | `BEAMUP_REPO` | the git remote BeamUp printed |
| Variable | `BEAMUP_APP` | the dokku app, `<hash>/heb-opensubtitles-stremio` |
| Variable | `ADDON_HOSTNAME` | the hostname BeamUp printed, without a scheme |

`ADDON_HOSTNAME` matters more than it looks: it builds the subtitle urls handed to
Stremio, so a wrong value gives subtitles that appear in the list and never load.

## Installing in Stremio

Open `https://<your-host>/configure`, enter your OpenSubtitles username and
password, and install. The resulting url contains your credentials, so treat it as
private.

# Contributing

PRs are welcome. Take a look at the open [issues](https://github.com/niroosh1997/heb-opensubtitles-stremio/issues)
to see where you can help, and open one if you hit a problem.

# License

[MIT](https://github.com/niroosh1997/heb-opensubtitles-stremio/blob/main/LICENSE),
inherited from the original project. The original copyright notice is kept intact.
