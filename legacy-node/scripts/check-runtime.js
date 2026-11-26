'use strict';

const runtime = require('../src/runtime');

try {
  runtime.assertSupported();
  console.log('[runtime] Node.js ' + process.versions.node + ' 满足 >= ' + runtime.MINIMUM_LABEL + ' 的要求');
} catch (error) {
  console.error('[runtime] ' + error.message);
  process.exit(1);
}
