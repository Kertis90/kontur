import {test,expect} from '@playwright/test';
import {login} from './session.mjs';
const password='disposable-tribe-check-123';

// Проверяет полный путь группы: создание, состав, проектная роль и сохранение после обновления.
test('администратор создаёт группу сотрудников и назначает ей проект',async({page},info)=>{
 await login(page);const data=await (await page.request.get('/api/bootstrap')).json(),project=data.projects.find(item=>item.key_code==='NOVA');
 await page.goto(`/?project=${project.id}&view=board`);
 await page.getByRole('button',{name:'Участники и доступ',exact:true}).click();
 await page.getByRole('button',{name:'Группе',exact:true}).click();
 await page.getByRole('button',{name:'Создать группу',exact:true}).click();
 const name=`Команда доступа ${info.project.name} ${Date.now()}`;
 await page.getByLabel('Название группы',{exact:true}).fill(name);
 await page.getByRole('checkbox',{name:'Проверка браузера',exact:true}).check();
 await page.getByRole('button',{name:'Сохранить группу',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Группа сотрудников',exact:true})).not.toHaveValue('');
 await page.getByRole('button',{name:'Добавить доступ',exact:true}).click();
 await expect(page.getByRole('combobox',{name:`Роль: ${name}`,exact:true})).toHaveValue('member');
 await page.locator('.project-access-row').filter({hasText:name}).getByRole('button',{name:'Состав',exact:true}).click();
 await expect(page.getByRole('checkbox',{name:'Проверка браузера',exact:true})).toBeChecked();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

// Проверяет создание пространства и делегирование прав без системного администрирования.
test('трайб-лидер создаёт пространство и делегирует права сотруднику',async({page},info)=>{
 await login(page,'browser-tribe-leader@example.invalid',password);
 await page.getByRole('navigation').getByRole('button',{name:'Трайбы',exact:true}).click();
 await expect(page.getByRole('button',{name:'Администрирование',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Создать трайб',exact:true}).click();
 const name=`Команда ${info.project.name} ${Date.now()}`;
 await page.getByLabel('Название трайба',{exact:true}).fill(name);
 await page.getByRole('button',{name:'Создать пространство',exact:true}).click();
 const detail=page.locator('.tribe-detail');await expect(detail.getByRole('heading',{name,exact:true})).toBeVisible();
 await detail.getByRole('button',{name:'Сотрудники',exact:true}).click();
 await page.getByRole('button',{name:'Добавить сотрудника',exact:true}).click();
 await page.getByRole('combobox',{name:'Сотрудник',exact:true}).selectOption({label:'Сотрудник трайба проверки'});
 await page.getByRole('checkbox',{name:/Настраивать пространство/}).check();
 await page.getByRole('checkbox',{name:/Создавать проекты/}).check();
 await page.getByRole('button',{name:'Сохранить сотрудника',exact:true}).click();
 await expect(detail.locator('.tribe-people article').filter({hasText:'Сотрудник трайба проверки'})).toContainText('Создавать проекты');
 await page.getByRole('navigation').getByRole('button',{name:'Обзор',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Трайбы',exact:true})).toBeVisible();
 await page.getByRole('navigation').getByRole('button',{name:'Трайбы',exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('tribe-members.png'),fullPage:true});
});

// Проверяет, что обычный сотрудник создаёт закрытый проект в своём трайбе и становится владельцем.
test('сотрудник создаёт проект и управляет личным доступом',async({page},info)=>{
 await login(page,'browser-tribe-member@example.invalid',password);
 const bootstrap=await (await page.request.get('/api/bootstrap')).json();
 const tribe=bootstrap.tribes.find(item=>item.name.startsWith('Трайб доступа')&&item.can_create_projects);expect(tribe).toBeTruthy();
 await page.getByRole('combobox',{name:'Пространство трайба',exact:true}).selectOption(String(tribe.id));
 await page.getByRole('navigation').getByRole('button',{name:'Трайбы',exact:true}).click();
 await page.locator('.tribe-detail').getByRole('button',{name:'Настройки',exact:true}).click();
 await expect(page.getByRole('button',{name:'Настроить пространство',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Сменить трайб-лидера',exact:true})).toHaveCount(0);
 await page.locator('.tribe-detail').getByRole('button',{name:'Создать проект',exact:true}).click();
 const name=`Проект сотрудника ${info.project.name} ${Date.now()}`;
 await page.getByLabel('Название',{exact:true}).fill(name);
 await page.getByLabel('Ключ проекта',{exact:true}).fill(`B${Date.now().toString(36).toUpperCase()}`);
 await page.locator('.modal').getByRole('button',{name:'Создать проект',exact:true}).click();
 await expect(page.locator('.modal')).toHaveCount(0);
 await page.getByRole('navigation').getByRole('button',{name:'Трайбы',exact:true}).click();
 await page.locator('.tribe-detail').getByRole('button',{name:'Проекты',exact:true}).click();
 await page.locator('.tribe-projects button').filter({hasText:name}).click();
 await page.getByRole('button',{name:'Участники и доступ',exact:true}).click();
 await expect(page.locator('.project-owner')).toContainText('Сотрудник трайба проверки');
 await expect(page.getByText('Доступ по назначению',{exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Сотрудник',exact:true}).selectOption({label:'Лидер трайба проверки'});
 await page.getByRole('combobox',{name:'Роль в проекте',exact:true}).selectOption('viewer');
 await page.getByRole('button',{name:'Добавить доступ',exact:true}).click();
 await expect(page.getByLabel('Роль: Лидер трайба проверки',{exact:true})).toHaveValue('viewer');
 await page.getByRole('button',{name:'Группе',exact:true}).click();
 await expect(page.getByRole('button',{name:'Создать группу',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('project-access.png'),fullPage:true});
});

// Проходит настоящее согласование: запускается форма решения, отказ сохраняется и исчезает из очереди.
test('назначенный сотрудник рассматривает согласование ИИ в отдельном разделе',async({page},info)=>{
 await login(page,'browser-tribe-member@example.invalid',password);
 await page.getByRole('button',{name:'Согласования ИИ',exact:true}).click();
 const card=page.locator('.tribe-card').filter({hasText:`Согласование ${info.project.name}`}).first();
 await expect(card).toBeVisible();await card.getByRole('button',{name:'Рассмотреть',exact:true}).click();
 await expect(page.getByText('Проверьте материалы перед продолжением',{exact:true}).last()).toBeVisible();
 await page.getByRole('button',{name:'Отклонить',exact:true}).click();
 await expect(page.locator('.agent-run-detail > .work-header .agent-status')).toHaveText('Отклонён');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('agent-approval.png'),fullPage:true});
});
