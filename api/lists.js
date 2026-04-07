const { buildFallbackPayload, buildFreshPayload, buildPayload } = require("../lib/lists");

module.exports = async function handler(req, res) {
  try {
    const shouldRefresh = req.query?.refresh === "1" || req.url?.includes("refresh=1");
    const payload = shouldRefresh ? await buildFreshPayload() : await buildPayload();
    res.status(200).json(payload);
  } catch (error) {
    res.status(200).json(buildFallbackPayload(error.message || "fetch failed"));
  }
};