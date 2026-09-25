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
  const [owner] = await rows('SELECT id,workspace_id FROM users WHERE email=?', [browserEnv.ADMIN_EMAIL]);
  // Даёт конструктору профиль для сохранения схемы; ИИ выключен, внешних запросов в проверке нет.
  const {saveAiSettings} = await import('../src/lib/ai-settings.js');
  const profileId = '34d11dac-539b-420c-9d20-a2ef1480eb22';
  await saveAiSettings(owner.workspace_id, {enabled:false, profiles:[{id:profileId,name:'Проверка сохранения схемы',enabled:true,base_url:'https://model.example.invalid/v1',model:'browser-check'}],project_profile_id:profileId,conference_profile_id:null}, owner.id);
  await rows("INSERT INTO users(workspace_id,email,display_name,password_hash,global_role,status) VALUES(?,?,?,?, 'viewer','active') ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash)", [owner.workspace_id, 'browser-viewer@example.invalid', 'Наблюдатель проверки', await bcrypt.hash('disposable-browser-viewer-123', 12)]);
  // Выдаёт наблюдателю только явные тестовые назначения в демонстрационный трайб и проект.
  const [viewer]=await rows('SELECT id FROM users WHERE email=?',['browser-viewer@example.invalid']);
  const [project]=await rows("SELECT id,tribe_id FROM projects WHERE workspace_id=? AND key_code='NOVA'",[owner.workspace_id]);
  if(project.tribe_id)await rows('INSERT IGNORE INTO tribe_members(tribe_id,user_id) VALUES(?,?)',[project.tribe_id,viewer.id]);
  await rows("INSERT IGNORE INTO project_members(project_id,user_id,project_role) VALUES(?,?,'viewer')",[project.id,viewer.id]);
} finally {await db.end();}
