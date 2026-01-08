function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const DEFAULT_RSSI = -80;

function rssiToWeight(rssi) {
  if (typeof rssi !== "number") return null;
  const normalized = (clamp(rssi, -90, -30) + 90) / 60;
  return Math.pow(normalized, 1.8);
}

function weightForNetwork(rssi) {
  const weight = rssiToWeight(rssi);
  if (weight !== null) return weight;
  return rssiToWeight(DEFAULT_RSSI);
}

function addScore(scores, channel, value) {
  if (!channel) return;
  if (channel < 1 || channel > 165) return;
  scores[channel] = (scores[channel] || 0) + value;
}

function compute24Scores(networks) {
  const scores = {};
  let missing = 0;
  const overlap = [0, 0.6, 0.3];
  networks.forEach((network) => {
    if (network.band !== "2.4") return;
    if (!network.channel) return;
    if (typeof network.rssi_dbm !== "number") missing += 1;
    const weight = weightForNetwork(network.rssi_dbm);
    addScore(scores, network.channel, weight);
    for (let offset = 1; offset <= 2; offset += 1) {
      addScore(scores, network.channel - offset, weight * overlap[offset]);
      addScore(scores, network.channel + offset, weight * overlap[offset]);
    }
  });
  return { scores, missing };
}

function compute5Scores(networks) {
  const scores = {};
  let missing = 0;
  networks.forEach((network) => {
    if (network.band !== "5") return;
    if (!network.channel) return;
    if (typeof network.rssi_dbm !== "number") missing += 1;
    const weight = weightForNetwork(network.rssi_dbm);
    addScore(scores, network.channel, weight);
  });
  return { scores, missing };
}

function pickLowestChannel(scores, candidates) {
  let bestChannel = candidates[0];
  let bestScore = scores[bestChannel] ?? 0;
  candidates.forEach((channel) => {
    const score = scores[channel] ?? 0;
    if (score < bestScore) {
      bestScore = score;
      bestChannel = channel;
    }
  });
  return { channel: bestChannel, score: bestScore };
}

function computeCongestion(networks) {
  const band24Result = compute24Scores(networks);
  const band5Result = compute5Scores(networks);
  const scores24 = band24Result.scores;
  const scores5 = band5Result.scores;
  const preferred24 = [1, 6, 11];
  const best24 = pickLowestChannel(scores24, preferred24);
  const missing24 = band24Result.missing;

  const band24 = {
    scoresByChannel: scores24,
    recommended: {
      channel: best24.channel,
      width_mhz: 20,
      reason: `Lowest congestion among 1/6/11 (score ${best24.score.toFixed(2)}).${
        missing24 ? " RSSI missing for some networks; using low default weight." : ""
      }`,
    },
  };

  const channelCandidates5 = Object.keys(scores5)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const fallback5 = channelCandidates5.length ? channelCandidates5 : [36, 40, 44, 48];
  const best5 = pickLowestChannel(scores5, fallback5);
  const maxScore5 = Object.values(scores5).reduce((max, value) => Math.max(max, value), 0);
  const width = maxScore5 > 2 ? 40 : 80;
  const missing5 = band5Result.missing;
  const reason =
    width === 80
      ? "Low congestion detected; 80 MHz should be fine."
      : "Higher congestion detected; 40 MHz should be more stable.";

  const band5 = {
    scoresByChannel: scores5,
    recommended: {
      channel: best5.channel,
      width_mhz: width,
      reason: `${reason}${missing5 ? " RSSI missing for some networks; using low default weight." : ""}`,
    },
  };

  return { band24, band5 };
}

module.exports = { computeCongestion };
