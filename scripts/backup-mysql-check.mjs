import {spawnSync} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {resolve, join, sep} from 'node:path';
import {Readable} from 'node:stream';
import assert from 'node:assert/strict';
import {encryptBackup, decryptBackup} from './backup-crypto.mjs';
import {restoreSql} from './backup-sql.mjs';

const root = resolve('.'), directory = await mkdtemp(join(root, '.backup-test-'));
const target = `kontur_restore_${randomUUID().replaceAll('-', '')}`;
const compose = ['compose', '-f', 'deploy/tests/browser.compose.yaml', 'exec', '-T', 'mysql', 'env', 'MYSQL_PWD=disposable-browser-root'];

// Выполняет команду только внутри именованного одноразового контейнера проверки.
function run(command, args, input) {
  const result = spawnSync('docker', [...compose, command, '-u', 'root', ...args], {input, maxBuffer: 64 * 1024 * 1024});
  if (result.status !== 0) throw new Error(`${command}: ${result.error?.message || result.stderr?.toString() || result.status}`);
  return result.stdout;
}

// Сверяет содержимое всех таблиц и журнал миграций после восстановления зашифрованной копии.
function snapshot(database) {
  const tables = run('mysql', ['-N', '-B', database, '-e', 'SHOW TABLES']).toString().trim().split('\n').map(name => name.trim());
  const counts = tables.map(table => {
    assert.match(table, /^[a-zA-Z0-9_]+$/);
    return `SELECT '${table}',COUNT(*) FROM \`${table}\``;
  }).join(' UNION ALL ');
  const values = run('mysql', ['-N', '-B', database, '-e', counts]).toString().trim();
  const checksums = run('mysql', ['-N', '-B', database, '-e', `CHECKSUM TABLE ${tables.map(table => `\`${table}\``).join(',')} EXTENDED`]).toString().trim().split('\n').map(line => line.split('\t')[1]);
  return values.split('\n').map((line, index) => {const [table, count] = line.trim().split('\t');return {table, count, checksum: checksums[index]};});
}

// Сверяет определения триггеров без необязательного внешнего завершителя SQL.
function triggers(database) {
  assert.match(database, /^[a-zA-Z0-9_]+$/);
  return run('mysql', ['-N', '-B', '-e', `SELECT TRIGGER_NAME,ACTION_TIMING,EVENT_MANIPULATION,EVENT_OBJECT_TABLE,TRIM(TRAILING ';' FROM ACTION_STATEMENT) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='${database}' ORDER BY TRIGGER_NAME`]).toString();
}

try {
  const before = snapshot('kontur_browser_test');
  const beforeTriggers = triggers('kontur_browser_test');
  const dump = run('mysqldump', ['--single-transaction', '--routines', '--events', '--triggers', '--set-gtid-purged=OFF', '--no-tablespaces', '--column-statistics=0', 'kontur_browser_test']);
  const file = join(directory, 'database.kbk'), key = randomBytes(32);
  await encryptBackup(Readable.from([dump]), file, key, {database: 'kontur_browser_test'});
  let executed = false;
  await assert.rejects(() => decryptBackup(file, randomBytes(32), () => {executed = true;}));
  assert.equal(executed, false, 'Неверный ключ не должен запускать восстановление');
  run('mysql', ['-e', `CREATE DATABASE \`${target}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`]);
  await decryptBackup(file, key, async sql => {
    const normalized = (await Array.fromAsync(restoreSql(Readable.from([await readFile(sql)])))).join('');
    run('mysql', ['--binary-mode', target], normalized);
  });
  assert.deepEqual(snapshot(target), before);
  assert.equal(triggers(target), beforeTriggers);
  console.log(`Копия восстановлена в отдельную БД; совпали содержимое и количество строк ${before.length} таблиц, журнал миграций и определения триггеров.`);
} finally {
  const safe = resolve(directory);
  if (!safe.startsWith(root + sep) || !safe.slice(root.length + 1).startsWith('.backup-test-')) throw new Error('Путь временной копии вышел за пределы проекта');
  await rm(safe, {recursive: true, force: true});
}
