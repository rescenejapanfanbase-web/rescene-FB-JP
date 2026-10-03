#!/usr/bin/env python3
"""Offline regression tests for Plus Chat schedule identity and cache fallback."""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from dataclasses import asdict
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('pluschat_sync', Path(__file__).with_name('sync-pluschat-schedule.py'))
sync = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = sync
SPEC.loader.exec_module(sync)


def event(title, time_value=None):
    return sync.build_event(original_title=title, year=2026, month=10, day=1,
                            time_value=time_value, all_day=time_value is None,
                            source_url='https://example.com/schedule')


class ScheduleIdentityTests(unittest.TestCase):
    def test_same_day_korean_events_survive_parser_and_merge(self):
        text = '1日木曜日\n계명대학교 축제\n終日\n대구보건대학교 축제\n終日\n계명대학교 축제\n終日'
        events = sync.parse_schedule_text(text, 2026, 10, 'https://example.com')
        self.assertEqual(len(events), 2)
        self.assertEqual(len({e.id for e in events}), 2)
        module_url = Path(__file__).with_name('merge-schedules.mjs').resolve().as_uri()
        script = '''import { mergeScheduleEvents } from MODULE;
import { readFileSync } from 'node:fs';
const events = mergeScheduleEvents([], JSON.parse(readFileSync(0, 'utf8'))).events;
console.log(JSON.stringify(events));'''.replace('MODULE', json.dumps(module_url))
        result = subprocess.run(['node', '--input-type=module', '-e', script],
                                input=json.dumps([asdict(e) for e in events]), text=True,
                                capture_output=True, check=True)
        merged = json.loads(result.stdout)
        self.assertEqual(len(merged), 2)
        self.assertEqual(len({e['id'] for e in merged}), 2)

    def test_timed_punctuation_and_long_titles_remain_distinct(self):
        for titles in [('행사 하나', '행사 둘'), ('A!', 'A?'), ('a' * 200 + 'x', 'a' * 200 + 'y')]:
            events = [event(t, (18, 0)) for t in titles]
            self.assertNotEqual(events[0].id, events[1].id)
            self.assertTrue(all(len(e.id) <= 180 for e in events))

    def test_translation_changes_do_not_change_id(self):
        before = event('계명대학교 축제')
        with patch.object(sync, 'TRANSLATIONS', {'exact': {'계명대학교 축제': '啓明大学 学園祭'}}):
            after = event('계명대학교 축제')
        self.assertNotEqual(before.title, after.title)
        self.assertEqual(before.id, after.id)

    def test_legacy_cache_migration_is_stable_and_preserves_fields(self):
        items = [asdict(event(t)) for t in ['행사 하나', '행사 둘']]
        for item in items:
            item['id'] = 'pluschat-2026-10-01-all-day'
        result = sync.normalize_cached_events(items + [items[0]])
        self.assertEqual(len(result), 2)
        self.assertEqual(len({e['id'] for e in result}), 2)
        self.assertEqual(result, sync.normalize_cached_events(result))
        self.assertEqual(result, list(reversed(sync.normalize_cached_events(list(reversed(items))))))
        for old, new in zip(items, result):
            self.assertEqual({k: v for k, v in old.items() if k != 'id'},
                             {k: v for k, v in new.items() if k != 'id'})

    def test_failed_fetch_migrates_cached_ids(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'cache.json'
            items = [asdict(event(t)) for t in ['행사 하나', '행사 둘']]
            for item in items:
                item['id'] = 'pluschat-2026-10-01-all-day'
            output.write_text(json.dumps({'events': items, 'months': {}}))
            args = argparse.Namespace(output=str(output), year=2026, month=10,
                                      months_ahead=0, diagnostics_dir=folder, input_text=None)
            with patch.object(sync, 'fetch_rendered_text', side_effect=RuntimeError('offline test')):
                self.assertEqual(sync.write_production(args), 0)
            payload = json.loads(output.read_text())
            self.assertEqual(len(payload['events']), 2)
            self.assertEqual(len({e['id'] for e in payload['events']}), 2)
            self.assertEqual(payload['months']['2026-10']['status'], 'cached')


if __name__ == '__main__':
    unittest.main()
