const STYLES = `
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #1a1620; color: #f2f2f2;
    display: flex; justify-content: center;
  }
  main { width: 100%; max-width: 460px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  p.sub { color: #b9b3c4; margin: 0 0 24px; font-size: 14px; line-height: 1.5; }
  label { display: block; margin: 16px 0 6px; font-size: 14px; color: #d8d3e0; }
  input {
    width: 100%; padding: 12px; font-size: 16px; border-radius: 8px;
    border: 1px solid #3b3446; background: #241f2c; color: #fff;
  }
  button {
    width: 100%; margin-top: 24px; padding: 14px; font-size: 16px; font-weight: 600;
    border: 0; border-radius: 8px; background: #7b5bf2; color: #fff; cursor: pointer;
  }
  button:disabled { background: #4b4358; cursor: not-allowed; }
  .note { margin-top: 20px; font-size: 13px; color: #b9b3c4; line-height: 1.5; }
  .out { display: none; margin-top: 24px; }
  .out.show { display: block; }
  .url {
    word-break: break-all; background: #241f2c; border: 1px solid #3b3446;
    border-radius: 8px; padding: 12px; font-size: 12px; font-family: ui-monospace, monospace;
  }
  a.install {
    display: block; text-align: center; margin-top: 12px; padding: 14px;
    background: #7b5bf2; color: #fff; border-radius: 8px; font-weight: 600; text-decoration: none;
  }
  .warn { color: #ffb4a2; }
`;

const SCRIPT = `
  // Matches how the server reads it: base64url of the JSON, via UTF-8 bytes so
  // that a non-ascii username survives.
  function encodeConfig(config) {
    var bytes = new TextEncoder().encode(JSON.stringify(config));
    var binary = "";
    bytes.forEach(function (b) { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  }

  document.getElementById("form").addEventListener("submit", function (event) {
    event.preventDefault();
    var username = document.getElementById("username").value.trim();
    var password = document.getElementById("password").value;
    if (!username || !password) { return; }

    var segment = encodeConfig({ username: username, password: password });
    var base = location.host + "/" + segment + "/manifest.json";

    document.getElementById("url").textContent = location.protocol + "//" + base;
    document.getElementById("install").href = "stremio://" + base;
    document.getElementById("out").classList.add("show");
    document.getElementById("out").scrollIntoView({ behavior: "smooth" });
  });
`;

const configureTemplate = (manifest) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${manifest.name}</title>
  <style>${STYLES}</style>
</head>
<body>
  <main>
    <h1>${manifest.name}</h1>
    <p class="sub">${manifest.description}</p>

    <form id="form">
      <label for="username">OpenSubtitles username</label>
      <input id="username" name="username" autocomplete="username"
             autocapitalize="none" autocorrect="off" spellcheck="false" required>

      <label for="password">OpenSubtitles password</label>
      <input id="password" name="password" type="password"
             autocomplete="current-password" required>

      <button type="submit">Create my install link</button>
    </form>

    <p class="note">
      Your own account is used, so downloads count against your quota: 20 a day on a
      free account. <span class="warn">Your credentials are part of the install link,
      so keep it to yourself.</span> Nothing is stored on the server.
    </p>

    <div class="out" id="out">
      <p class="note">Open this on the device running Stremio:</p>
      <div class="url" id="url"></div>
      <a class="install" id="install" href="#">Install in Stremio</a>
    </div>
  </main>
  <script>${SCRIPT}</script>
</body>
</html>`;

module.exports = configureTemplate;
