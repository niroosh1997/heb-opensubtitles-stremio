const configureTemplate = require("./configureTemplate");
const { MANIFEST } = require("../manifest");

module.exports = (req, res) => {
  res.type("html");
  res.send(configureTemplate(MANIFEST));
};
