// Ограничивает представление выбранным трайбом; серверные права остаются независимыми от этого фильтра.
export function tribeViewData(company,tribeId){
 if(!company||!tribeId)return company;
 const tribe=company.tribes?.find(item=>Number(item.id)===Number(tribeId));if(!tribe)return company;
 const projects=company.projects.filter(project=>Number(project.tribe_id)===Number(tribeId)),ids=new Set(projects.map(project=>Number(project.id)));
 const selected={...company,currentTribe:tribe,projects,permissions:{...company.permissions,features:{...company.permissions.features,'project.create':Boolean(tribe.can_create_projects)},manageProjects:Boolean(tribe.can_create_projects)}};
 for(const key of ['tasks','sprints','releases','components'])selected[key]=(company[key]||[]).filter(item=>ids.has(Number(item.project_id)));
 return selected;
}
