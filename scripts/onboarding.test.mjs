import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './test-module-loader.mjs';

// Создаёт запрос изменения названия для проверки прав и защиты от одновременных правок.
function request(name = 'Команда', previous_name = 'Организация') {
  return new Request('https://kontur.test/api/work/onboarding', {method: 'PUT', body: JSON.stringify({name, previous_name})});
}

test('название организации недоступно наблюдателю, служебному пользователю и токену', async () => {
  const {onboardingApi} = await load('work-onboarding.js');
  for (const user of [{global_role: 'viewer'}, {global_role: 'owner', api_token_id: 1}, {global_role: 'admin', is_service: true}]) {
    await assert.rejects(() => onboardingApi(request(), user), error => error.status === 403);
  }
});

test('владелец сохраняет название своего пространства и оставляет аудит', async () => {
  const changes = [], events = [];
  const {onboardingApi} = await load('work-onboarding.js', {'db.js': {transaction: async run => run({query: async (sql, values) => {changes.push({sql, values});return sql.startsWith('SELECT') ? [[{name: 'Организация'}]] : [{}];}})}, 'audit.js': {audit: async (...event) => events.push(event)}});
  const response = await onboardingApi(request(' Новая команда '), {global_role: 'owner', workspace_id: 7});
  assert.deepEqual(await response.json(), {name: 'Новая команда'});
  assert.deepEqual(Array.from(changes[1].values), ['Новая команда', 7]);
  assert.equal(events[0][1], 'workspace.renamed');
});

test('устаревшая форма не перезаписывает изменение другого администратора', async () => {
  let changed = false;
  const {onboardingApi} = await load('work-onboarding.js', {'db.js': {transaction: async run => run({query: async sql => {if (sql.startsWith('SELECT')) return [[{name: 'Уже изменено'}]];changed = true;return [{}];}})}});
  await assert.rejects(() => onboardingApi(request(), {global_role: 'admin', workspace_id: 7}), error => error.status === 409);
  assert.equal(changed, false);
});
