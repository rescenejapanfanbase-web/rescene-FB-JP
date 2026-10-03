import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildScheduleIcs } from './calendar-ics.mjs';

// Execute the actual browser predicate without booting unrelated DOM controls.
const source = readFileSync(new URL('../js/schedule.js', import.meta.url), 'utf8');
const start = source.indexOf('const isRecurringDuplicate =');
const end = source.indexOf('const eventsForYears =', start);
assert.ok(start >= 0 && end > start);
const context = { eventDates: e => [e.date] };
vm.createContext(context);
vm.runInContext(source.slice(start, end) + '\nglobalThis.check = isRecurringDuplicate;', context);
const members = [['WONI','05-25'],['MAY','08-19'],['LIV','10-11'],['ZENA','11-27'],['MINAMI','11-29']];
for (const [name, day] of members) {
  const date = `2026-${day}`;
  const candidate = { recurringMember:name, date };
  const official = { id:`plus-${name}`,title:`🎉 HAPPY ${name} DAY`,date,start:date,category:'イベント' };
  assert.equal(context.check(candidate,[official]),true, name);
  assert.equal(context.check(candidate,[{...official,date:'2026-01-01'}]),false);
  assert.equal(context.check(candidate,[{...official,title:'🎉 HAPPY OTHER DAY'}]),false);
  assert.equal(context.check(candidate,[{...official,title:`HAPPY ${name} DAY カフェイベント`}]),false);
  assert.equal(context.check(candidate,[{...official,title:`${name} 誕生日`}]),true);
  const ics = buildScheduleIcs([official], {generatedAt:'2026-10-03T00:00:00Z'});
  assert.ok(!ics.includes(`UID:plus-${name}@`));
  assert.ok(ics.includes(`SUMMARY:${name} 誕生日`));
  const separate = buildScheduleIcs([{...official,title:`HAPPY ${name} DAY カフェイベント`}], {generatedAt:'2026-10-03T00:00:00Z'});
  assert.ok(separate.includes(`UID:plus-${name}@`));
}
console.log('✅ 誕生日重複検査: 5人のHappy Day表記、別日・別人・関連イベント保持、ICSを確認');
