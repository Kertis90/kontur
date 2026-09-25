import {one,rows} from './db.js';
import {WorkError} from './work-error.js';

export const TRIBE_RIGHTS=['can_manage_space','can_manage_members','can_create_projects','can_manage_projects'];

// Разрешает администрирование компании только её системному владельцу и администратору.
export function companyAdmin(user){return !user?.is_service&&['owner','admin'].includes(user?.global_role);}

// Читает права в одном трайбе, не превращая делегированное право в глобальную роль.
export async function tribeAccess(user,tribeId,connection=null){
 const sql='SELECT t.*,m.user_id AS member_id,m.can_manage_space,m.can_manage_members,m.can_create_projects,m.can_manage_projects FROM tribes t LEFT JOIN tribe_members m ON m.tribe_id=t.id AND m.user_id=? WHERE t.id=? AND t.workspace_id=?';
 const params=[user.id,tribeId,user.workspace_id];
 const tribe=connection?(await connection.query(sql,params))[0][0]:await one(sql,params);
 if(!tribe||user.is_service)return null;
 const leader=Number(tribe.leader_id)===Number(user.id),admin=companyAdmin(user);
 if(!leader&&!admin&&!tribe.member_id)return null;
 return {...tribe,is_leader:leader,can_assign_leader:leader||admin,...Object.fromEntries(TRIBE_RIGHTS.map(key=>[key,Boolean(admin||leader||tribe[key])]))};
}

// Проверяет выбранный трайб перед созданием проекта; старым клиентам администратора разрешён проект без распределения.
export async function requireProjectTribe(user,tribeId,connection=null){
 if(!tribeId){if(companyAdmin(user))return null;throw new WorkError(422,'Выберите трайб для нового проекта');}
 const tribe=await tribeAccess(user,tribeId,connection);
 if(!tribe?.can_create_projects)throw new WorkError(403,'Нет права создавать проекты в этом трайбе');
 return tribe;
}

// Показывает только пространства, в которых у сотрудника есть членство или полномочия лидера.
export async function listTribes(user){
 if(user.is_service)return [];
 const all=await rows('SELECT t.*,u.display_name AS leader_name FROM tribes t JOIN users u ON u.id=t.leader_id WHERE t.workspace_id=? ORDER BY t.name',[user.workspace_id]);
 const result=[];
 for(const tribe of all){const access=await tribeAccess(user,tribe.id);if(access)result.push({...tribe,...access});}
 return result;
}
