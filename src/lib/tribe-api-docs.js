// Описывает иерархию компании и действия, полномочия которых ограничены конкретным трайбом.
const endpoint=(method,path,title,description,example)=>({tag:'Трайбы',method,path:`/api/work/tribes${path}`,title,description,scope:method==='GET'?'projects:read':'projects:write',...(example?{body:{contentType:'application/json',example}}:{})});
export const TRIBE_API_ENDPOINTS=[
 endpoint('GET','','Мои трайбы','Только трайбы сотрудника, их лидеры и текущие права. Системным администраторам доступны все трайбы компании.'),
 endpoint('POST','','Создать пространство трайба','Нужно право tribe.create. По умолчанию лидер — создатель. Другого лидера при создании назначает только системный администратор.',{name:'Клиентский опыт',description:'Продукты для клиентов',color:'#e30611'}),
 endpoint('GET','/{tribeId}','Пространство и сотрудники','Возвращает tribe, members и people для управления составом. Чужая компания и отсутствие членства дают 404.'),
 endpoint('PATCH','/{tribeId}','Настроить пространство','Нужно can_manage_space. revision обязательна; устаревшая форма получает 409.',{revision:1,name:'Клиентский опыт',description:'Продукты и сервисы',color:'#e30611'}),
 endpoint('PUT','/{tribeId}/members','Добавить сотрудника или изменить его права','Нужно can_manage_members. Делегировать и отзывать можно только свои полномочия. Глобальная роль пользователя не меняется.',{revision:1,user_id:12,can_manage_space:true,can_manage_members:false,can_create_projects:true,can_manage_projects:false}),
 endpoint('DELETE','/{tribeId}/members/{userId}','Убрать сотрудника','revision передаётся в JSON. Нельзя убрать лидера, владельца действующего проекта или сотрудника с неподконтрольными правами.',{revision:2}),
 endpoint('POST','/{tribeId}/leader','Передать руководство трайбом','Только действующий лидер или системный администратор. Новый лидер — активный сотрудник текущей компании; прежние прямые назначения сохраняются.',{revision:2,user_id:12}),
 endpoint('POST','/{tribeId}/projects','Распределить существующий проект','Только системный администратор. Проект становится закрытым; его владелец включается в состав трайба. Проверяются версии трайба и доступа проекта.',{revision:2,project_id:8,access_revision:1}),
];
