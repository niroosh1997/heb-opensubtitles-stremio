# heb-opensubtitles-stremio

A Stremio addon serving Hebrew subtitles from OpenSubtitles. Every user signs in
with their own OpenSubtitles account, so downloads come out of their own daily
quota rather than a shared key. Credentials travel in the addon URL as an
encoded config segment. Express, deployed to BeamUp.

Only what is not obvious from the code is written here.

## Invariants

**Credentials never appear in a log.** `common/userConfig.js` redacts the config
segment, and anything unrecognised in the first path position is redacted too,
so a new route cannot leak one by being forgotten.

**Sessions are keyed on the username _and_ the password**, hashed. Keyed on the
username alone, any password at all was answered with whichever session that
user already had, so a wrong password looked accepted and spent their downloads.
The same holds for the cache of credentials OpenSubtitles has rejected.

**A download costs quota; a search does not.** The allowance is about 20 a day.
Nothing may spend a download to decide how to rank or present a subtitle — the
subtitle content is not available at ranking time and must not be fetched to
get it.

**The subtitles list is fetched without a session and shared by every user.**
Only downloading is per user. Do not put anything user-specific into the search
or its cache key.

**Ranking happens per request, after the cache.** The cache key is the title
(`type`, `imdbID`, `season`, `episode`, `languages`) so one entry serves every
release, and each request still orders that list against its own filename.

**A failure is never stored as a result.** Caches delete on error rather than
remembering an empty or broken answer.

## Traps

**Stremio fires about sixteen requests at one failing subtitle in three
seconds.** Any new call to OpenSubtitles on the download path needs a guard, or
one tap spends sixteen calls learning the same thing. `downloadFailureCache`
and the rejected-credentials cache in the client are those guards; changing
either means re-checking the burst.

**OpenSubtitles specifics.** Quota exhausted is `406`, not `429` — `429` is the
per-second throttle. `406` also covers an invalid file id and an invalid token,
so it is overloaded and the current reading of it as "quota" is a known
simplification. Login is limited to 1/s, 10/min, 30/hour. The imdb id goes as a
plain integer with no `tt` and no leading zeroes. `Accept: application/json`
must be sent explicitly or their edge answers with a 503 HTML page.

**BeamUp forces `Cache-Control: max-age=14400` on anything ending `.json`** —
the manifest _and_ the subtitle lists, overriding whatever the addon sets. A
release can take four hours to reach users. When verifying a deploy, bust the
cache with a parameter placed **inside the query segment, before `.json`**;
appending it after `.json` misses the route and returns HTML.

**`HOSTNAME` is set by Docker to the container id.** The addon's own variable is
`ADDON_HOSTNAME`.

**`lru-cache` captures its clock when the module loads**, so sinon fake timers
installed afterwards do not affect it. TTL tests use real short TTLs instead.

## Conventions

Comments say _why_. The reasoning behind a change belongs in the commit message,
not in the source. One concern per pull request.

New behaviour is mutation tested before it is trusted: break the code, confirm
the suite goes red in the test that should catch it, restore, confirm green. A
green suite proves nothing on its own — two tests in this repo have passed while
asserting nothing, one from a sinon spy shared across two calls and read through
`firstCall`, one from comparing against an array the test had itself mutated.

Claims about behaviour are checked against the real API rather than reasoned
from the code. Several conclusions in this repo's history were confidently wrong
until measured.

## Commands

```bash
npm test          # mocha
npx eslint .      # lint, --fix to format
npm run start     # needs OPENSUBTITLES_API_KEY
```

Deploys run from the `beamup-deployment.yml` workflow, which retries through
BeamUp's deploy lock.
