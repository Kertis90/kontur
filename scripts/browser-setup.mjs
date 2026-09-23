import {spawnSync} from 'node:child_process';
import {browserEnv} from './browser-env.mjs';

// Подготавливает только выделенную тестовую БД; рабочие реквизиты окружения заменяются явными тестовыми.
for (const script of ['scripts/migrate.mjs', 'scripts/seed.mjs']) {
  const result = spawnSync(process.execPath, [script], {stdio: 'inherit', env: {...process.env, ...browserEnv}});
  if (result.status !== 0) process.exit(result.status || 1);
}
Object.assign(process.env, browserEnv);
const {db, rows} = await import('../src/lib/db.js');
const {default: bcrypt} = await import('bcryptjs');
try {
  const [owner] = await rows('SELECT workspace_id FROM users WHERE email=?', [browserEnv.ADMIN_EMAIL]);
  await rows("INSERT INTO users(workspace_id,email,display_name,password_hash,global_role,status) VALUES(?,?,?,?, 'viewer','active') ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash)", [owner.workspace_id, 'browser-viewer@example.invalid', 'Наблюдатель проверки', await bcrypt.hash('disposable-browser-viewer-123', 12)]);
} finally {await db.end();}
