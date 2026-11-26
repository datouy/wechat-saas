'use strict';

const MINIMUM = Object.freeze({ major: 22, minor: 5, patch: 0 });
const MINIMUM_LABEL = '22.5.0';

function parse(version) {
  const match = String(version || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function isSupported(version) {
  const parsed = parse(version);
  if (!parsed) return false;
  if (parsed.major !== MINIMUM.major) return parsed.major > MINIMUM.major;
  if (parsed.minor !== MINIMUM.minor) return parsed.minor > MINIMUM.minor;
  return parsed.patch >= MINIMUM.patch;
}

function assertSupported(version = process.versions.node) {
  if (isSupported(version)) return true;
  throw new Error(
    'Node.js ' + MINIMUM_LABEL + ' 或更高版本是必需条件；当前版本为 ' + version + '。' +
    ' 请切换到 Node.js 22/24 后重新执行。'
  );
}

module.exports = { MINIMUM, MINIMUM_LABEL, parse, isSupported, assertSupported };
