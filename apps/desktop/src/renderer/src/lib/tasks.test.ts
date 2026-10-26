import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { itemSchema, localDate, workspaceSchema } from '@dock/contracts';
import { parseTaskText, compileFilter, compareTasks, recurrenceLabel, matchesSearch } from './tasks.ts';

const projectId = randomUUID();
const workspace = workspaceSchema.parse({ projects: [{ id: projectId, name: 'Release plan' }] });
const now = new Date(2026, 9, 25, 12, 0);
test('task ordering keeps due work visible ahead of unscheduled ideas, then orders by priority and schedule', () => {
  const task = (title: string, priority: number, scheduledAt: string | null) => itemSchema.parse({
    id: randomUUID(), kind: 'task', title, body: '', space: 'Inbox', priority: priority < 4,
    done: false, scheduledAt, recurrence: 'none', linkedNoteId: null,
    createdAt: now.toISOString(), updatedAt: now.toISOString(), revision: 1, task: { priority },
  });
  const tasks = [task('Idea', 4, null), task('Tomorrow urgent', 1, new Date(2026, 9, 26, 9).toISOString()),
    task('Due normal', 4, new Date(2026, 9, 25, 9).toISOString()), task('Due urgent', 1, new Date(2026, 9, 25, 10).toISOString()),
    task('Overdue urgent', 1, new Date(2026, 9, 24, 10).toISOString())];
  assert.deepEqual(tasks.sort((a, b) => compareTasks(a, b, '2026-10-25')).map(item => item.title),
    ['Overdue urgent', 'Due urgent', 'Due normal', 'Tomorrow urgent', 'Idea']);
});
test('capture resolves local date, named project, priority, labels and duration without altering ordinary words', () => {
  const parsed = parseTaskText('Write notes next Tue 9am #"Release plan" p2 @writing for 45m', workspace, now);
  assert.equal(parsed.title, 'Write notes');
  assert.equal(localDate(new Date(parsed.scheduledAt!)), '2026-10-27');
  assert.equal(new Date(parsed.scheduledAt!).getHours(), 9);
  assert.deepEqual(parsed.task, { projectId, priority: 2, durationMinutes: 45 });
  assert.deepEqual(parsed.tags, ['writing']);
  assert.equal(parseTaskText('Call at 14:30 #Work', workspace, now).title, 'Call #Work');
  assert.equal(parseTaskText('Meet Friday tomorrow', workspace, now, ['tomorrow']).title, 'Meet Friday tomorrow');
  assert.equal(parseTaskText('Plan next steps for tomorrowland', workspace, now).title, 'Plan next steps for tomorrowland');
  assert.throws(() => parseTaskText('Plan every 2 weekdays', workspace, now), /every weekday/);
  assert.throws(() => parseTaskText('Call 25:99', workspace, now), /valid time/);
  assert.throws(() => parseTaskText('Call 2026-02-30', workspace, now), /valid date/);
});
test('saved queries honor parentheses, precedence, negation, project names and labels', () => {
  const item = itemSchema.parse({ id: randomUUID(), kind: 'task', title: 'Write notes', body: '', space: 'Inbox', priority: true, done: false, scheduledAt: new Date(2026, 9, 25, 9).toISOString(), recurrence: 'none', linkedNoteId: null, createdAt: now.toISOString(), updatedAt: now.toISOString(), revision: 1, tags: ['writing'], task: { priority: 1, projectId } });
  assert.equal(compileFilter('(today | overdue) & p1 & #"Release plan" & @writing', workspace, now)(item), true);
  assert.equal(compileFilter('done', workspace, now)({ ...item, done: true }), true);
  assert.equal(compileFilter('p1', workspace, now)({ ...item, done: true }), false);
  assert.throws(() => compileFilter('due:2026-02-30', workspace, now), /YYYY-MM-DD/);
  assert.equal(compileFilter('today & !@writing', workspace, now)(item), false);
  assert.equal(compileFilter('p2 | p1 & @writing', workspace, now)(item), true);
  assert.throws(() => compileFilter('(today |', workspace, now), /rule/);
  assert.throws(() => compileFilter('today overdue', workspace, now), /Join rules/);
  assert.throws(() => compileFilter('#Missing', workspace, now), /Unknown project/);
});

test('repeat labels read naturally and search covers labels, comments and projects', () => {
  const item = itemSchema.parse({ id: randomUUID(), kind: 'task', title: 'Water plants', body: '', space: 'Inbox', priority: false, done: false,
    scheduledAt: new Date(2026, 9, 25, 9).toISOString(), recurrence: 'custom', linkedNoteId: null, createdAt: '2026-10-25T00:00:00.000Z',
    updatedAt: '2026-10-25T00:00:00.000Z', revision: 1, tags: ['home'],
    task: { projectId, repeat: { interval: 3, unit: 'day', afterCompletion: true },
      comments: [{ id: randomUUID(), body: 'Use the blue can', createdAt: '2026-10-25T00:00:00.000Z' }] } });
  assert.equal(recurrenceLabel(item), 'Every 3 days after completion');
  assert.equal(recurrenceLabel({ ...item, recurrence: 'weekdays' }), 'Every weekday');
  for (const query of ['@home', 'blue can', 'release plan']) assert.equal(matchesSearch(item, query, workspace), true);
  assert.equal(matchesSearch(item, 'missing', workspace), false);
});
