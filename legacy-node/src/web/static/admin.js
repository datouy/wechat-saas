/* 经营台启动入口：核心与领域模块加载完成后启动。 */
(function () {
  'use strict';
  if (!window.AdminRuntime) throw new Error('经营台核心未加载');
  window.AdminRuntime.start();
})();
