const results = [];
export function ok(name, cond, extra = '') {
  results.push((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  (' + extra + ')' : ''));
}
export function report(suite) {
  const pass = results.filter((r) => r.startsWith('PASS')).length;
  console.log('\n==== ' + suite + ' ====');
  console.log(results.join('\n'));
  console.log('---- ' + suite + ': ' + pass + '/' + results.length + ' ----');
  return { pass, total: results.length };
}
export const assert = {
  eq(a, b, m) { ok(m, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + ' == ' + JSON.stringify(b)); },
};