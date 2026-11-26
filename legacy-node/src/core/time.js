/**
 * 业务日期工具：所有“今日/日期”判断统一使用 Asia/Shanghai
 * 避免用 toISOString().slice(0,10) 造成 UTC 日期错位
 */
function cnDate(date) {
  const d = date || new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  const get = (t) => parts.find(p => p.type === t).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}

module.exports = { cnDate };

