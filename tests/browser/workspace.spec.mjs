import {test, expect} from '@playwright/test';
import {login} from './session.mjs';

test('ИИ-агенты открываются с действующими правами и показывают визуальный конструктор', async ({page}, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page);
  await page.getByRole('button', {name: 'ИИ-агенты', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'ИИ-агенты', exact: true})).toBeVisible();
  await page.getByRole('button', {name: '+ Создать агента', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Схема агента'})).toBeVisible();
  await expect(page.locator('.canvas-node-handle').filter({hasText:'Источники и параметры'})).toBeVisible();
  await page.getByRole('button', {name: 'Увеличить масштаб'}).click();
  await expect(page.getByLabel('Масштаб', {exact: true})).toHaveText('90%');
  await page.getByRole('button', {name: 'Вписать', exact: true}).click();
  const canvas=await page.locator('.agent-canvas').boundingBox();
  for(const node of await page.locator('.canvas-node').all()){const box=await node.boundingBox();expect(box.x).toBeGreaterThanOrEqual(canvas.x);expect(box.x+box.width).toBeLessThanOrEqual(canvas.x+canvas.width+1);}
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({path: testInfo.outputPath('agent-canvas.png'), fullPage: true});
});

test('конструктор добавляет ветви и действия, двигает триггер и отменяет изменения',async({page},testInfo)=>{
 await login(page);await page.getByRole('button',{name:'ИИ-агенты',exact:true}).click();await page.getByRole('button',{name:'+ Создать агента',exact:true}).click();
 const library=page.getByRole('complementary',{name:'Библиотека блоков'});
 await library.getByRole('button',{name:'Условие',exact:false}).click();
 await page.getByLabel('Название шага',{exact:true}).fill('Проверка риска');
 await library.getByRole('button',{name:'Действие',exact:false}).click();
 await expect(page.getByRole('combobox',{name:'Действие',exact:true})).toHaveValue('create_task');
 await page.getByLabel('Название шага',{exact:true}).fill('Задача при риске');
 await page.getByRole('combobox',{name:'Настройки блока',exact:true}).selectOption({label:'Проверка риска'});
 await page.getByRole('combobox',{name:'Да →',exact:true}).selectOption({label:'Задача при риске'});
 await expect(page.getByRole('combobox',{name:'Нет →',exact:true})).toHaveValue('$end');
 await page.getByRole('button',{name:'Вписать',exact:true}).click();
 const trigger=page.locator('[data-node-id="$trigger"]'),before=await trigger.getAttribute('style');
 await trigger.getByRole('button').focus();await page.keyboard.press('Alt+ArrowRight');
 await expect(trigger).not.toHaveAttribute('style',before);
 await page.getByRole('button',{name:'↶ Отменить',exact:true}).click();await expect(trigger).toHaveAttribute('style',before);
 await expect(page.getByRole('combobox',{name:'Да →',exact:true})).toHaveValue('step_2');
 await trigger.scrollIntoViewIfNeeded();const handle=await trigger.getByRole('button').boundingBox();
 await page.mouse.move(handle.x+30,handle.y+20);await page.mouse.down();await page.mouse.move(handle.x+60,handle.y+44,{steps:5});await page.mouse.up();
 await expect(trigger).not.toHaveAttribute('style',before);const moved=await trigger.getAttribute('style');
 await page.getByRole('button',{name:'Проверка риска: Нет',exact:true}).click();
 await page.locator('[data-node-id="step_2"] .canvas-node-handle').click();
 await page.getByRole('combobox',{name:'Настройки блока',exact:true}).selectOption({label:'Проверка риска'});
 await expect(page.getByRole('combobox',{name:'Нет →',exact:true})).toHaveValue('step_2');
 await page.getByRole('combobox',{name:'Нет →',exact:true}).selectOption('$end');
 const name=`Схема ${testInfo.project.name} ${Date.now()}`;
 await page.getByLabel('Название агента',{exact:true}).fill(name);
 await page.getByRole('button',{name:'Сохранить схему',exact:true}).click();
 const card=page.locator('.agent-card').filter({hasText:name});await expect(card).toBeVisible();
 await card.getByRole('button',{name:'Настроить',exact:true}).click();
 await expect(page.locator('[data-node-id="$trigger"]')).toHaveAttribute('style',moved);
 await page.getByRole('combobox',{name:'Настройки блока',exact:true}).selectOption({label:'Проверка риска'});
 await expect(page.getByRole('combobox',{name:'Да →',exact:true})).toHaveValue('step_2');
 await expect(page.getByRole('combobox',{name:'Нет →',exact:true})).toHaveValue('$end');
 if(testInfo.project.name==='desktop')await page.setViewportSize({width:1893,height:980});
 await page.getByRole('button',{name:'Вписать',exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:testInfo.outputPath('agent-branches.png'),fullPage:true});
});

// Проверяет перемещение нового блока мышью даже при незавершённом выборе связи.
test('новый блок перемещается после выбора связи',async({page})=>{
 await login(page);await page.getByRole('button',{name:'ИИ-агенты',exact:true}).click();await page.getByRole('button',{name:'+ Создать агента',exact:true}).click();
 await page.getByRole('complementary',{name:'Библиотека блоков'}).getByRole('button',{name:'Условие',exact:false}).click();
 await page.getByRole('button',{name:'Вписать',exact:true}).click();
 const node=page.locator('[data-node-id="step_1"]'),before=await node.getAttribute('style');
 await page.getByRole('button',{name:'Источники и параметры: Далее',exact:true}).click();
 await node.locator('.canvas-node-handle').scrollIntoViewIfNeeded();
 const box=await node.locator('.canvas-node-handle').boundingBox();
 await page.mouse.move(box.x+50,box.y+30);await page.mouse.down();await page.mouse.move(box.x+100,box.y+65,{steps:8});await page.mouse.up();
 await expect(node).not.toHaveAttribute('style',before);
 await expect(page.getByRole('button',{name:'Отменить связь',exact:true})).toHaveCount(0);
 const edge=page.locator('[data-edge="$sources.entry"]');await edge.locator('path').focus();await page.keyboard.press('Enter');
 await page.getByLabel('Сторона выхода',{exact:true}).selectOption('top');await page.getByLabel('Сторона входа',{exact:true}).selectOption('right');
 await expect(edge).toHaveAttribute('data-from-side','top');await expect(edge).toHaveAttribute('data-to-side','right');
 await page.getByRole('button',{name:'Закрыть настройки связи',exact:true}).click();
 await page.getByRole('button',{name:'↶ Отменить',exact:true}).click();await expect(edge).not.toHaveAttribute('data-to-side','right');
});

// Проверяет личные ссылки на обоих экранах и сохранение серверного порядка после перезагрузки.
test('избранное хранит выбранные ссылки и их порядок',async({page})=>{
 await login(page);await page.getByRole('button',{name:'Открыть избранное',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Личное избранное'});
 const old=await page.request.get('/api/work/favorites'),value=await old.json();await page.request.put('/api/work/favorites',{data:{revision:value.revision,items:[]}});await page.reload();await page.getByRole('button',{name:'Открыть избранное',exact:true}).click();
 await dialog.locator('.favorite-choices button').first().click();await expect(dialog.locator('.favorite-row')).toHaveCount(1);
 await dialog.getByRole('combobox',{name:'Тип ссылки',exact:true}).selectOption('board');await dialog.locator('.favorite-choices button').first().click();await expect(dialog.locator('.favorite-row')).toHaveCount(2);
 await dialog.locator('.favorite-row').nth(1).getByRole('button',{name:/Выше:/}).click();await expect(dialog.locator('.favorite-row small').first()).toHaveText('Доска');
 await page.reload();await page.getByRole('button',{name:'Открыть избранное',exact:true}).click();await expect(dialog.locator('.favorite-row small').first()).toHaveText('Доска');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

// Проверяет сохранение оценки и просмотр общего сценария через пользовательские формы.
test('приоритет плана виден в общей карте',async({page},testInfo)=>{
 await login(page);const title=`Карта ${testInfo.project.name} ${Date.now()}`;const created=await page.request.post('/api/work/plans',{data:{title,request_id:crypto.randomUUID(),start_date:'2026-10-01',due_date:'2026-10-10'}});expect(created.ok()).toBe(true);const plan=await created.json();
 await page.goto(`/?view=work&tab=plans&plan=${plan.id}`);await page.getByRole('button',{name:'Оценить приоритет',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Приоритет плана'});await dialog.getByLabel('Ожидаемый результат',{exact:true}).fill('Сократить время подготовки отчёта');await dialog.getByLabel('Эффект, от 0 до 10',{exact:true}).fill('8');await dialog.getByLabel('Усилия, человеко-дней',{exact:true}).fill('4');await dialog.getByRole('button',{name:'Сохранить оценку',exact:true}).click();await expect(page.locator('.plan-score')).toContainText('2.00');
 await page.getByRole('tab',{name:'Общая карта',exact:true}).click();await expect(page.getByRole('heading',{name:'Общая карта работы',exact:true})).toBeVisible();await page.getByRole('combobox',{name:'Проект или план',exact:true}).selectOption(`plan:${plan.id}`);await page.getByLabel('Сдвиг начала, дней',{exact:true}).fill('7');await page.getByRole('button',{name:'Посмотреть сценарий',exact:true}).click();await expect(page.locator('.roadmap-row')).toHaveCount(1);await expect(page.locator('.roadmap-bar')).toHaveAttribute('title',new RegExp('8 окт'));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:testInfo.outputPath('shared-roadmap.png'),fullPage:true});
 await page.getByRole('button',{name:'Проверить и сохранить сроки',exact:true}).click();const confirm=page.getByRole('dialog',{name:'Подтвердить новые сроки'});await expect(confirm).toContainText(title);await confirm.getByRole('button',{name:/Сохранить выбранные сроки/}).click();await expect(confirm).toHaveCount(0);const updated=await (await page.request.get(`/api/work/plans/${plan.id}`)).json();expect(updated.start_date).toBe('2026-10-08');
});

test('чат компактен, поле ввода в окне, быстрый доступ без отдельной прокрутки',async({page},testInfo)=>{
 await login(page);await page.getByRole('button',{name:'Чат и встречи',exact:true}).click();
 const discover=page.getByRole('button',{name:'Найти комнату',exact:false});await expect(discover).toBeVisible();
 const bounds=await discover.boundingBox();expect(bounds.height).toBeLessThan(65);expect(bounds.width).toBeGreaterThan(110);
 const composer=page.getByPlaceholder('Напишите сообщение…');await expect(composer).toBeVisible();
 const box=await composer.boundingBox();expect(box.y+box.height).toBeLessThanOrEqual(page.viewportSize().height);
 const heading=await page.getByRole('heading',{name:'Чат и встречи',exact:true}).boundingBox();expect(heading.height).toBeLessThan(40);
 if(testInfo.project.name==='desktop')expect(await page.locator('.sidebar-projects').evaluate(el=>getComputedStyle(el).overflowY)).toBe('visible');
 else expect((await page.locator('.sidebar nav button').first().boundingBox()).width).toBeLessThan(90);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('compact-chat.png'),fullPage:true});
});

test('план создаёт эпик в работающем проекте и сразу показывает его на доске',async({page},testInfo)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await login(page);
 await page.goto('/?view=work&tab=plans');await page.getByRole('button',{name:'+ Новый план',exact:true}).click();
 const projectOptions=page.getByRole('combobox',{name:'Где планируем',exact:true}).locator('option');const projectId=await projectOptions.nth(1).getAttribute('value');
 await page.getByRole('combobox',{name:'Где планируем',exact:true}).selectOption(projectId);
 const name=`План ${testInfo.project.name} ${Date.now()}`,title=`Эпик ${testInfo.project.name} ${Date.now()}`;
 await page.getByLabel('Название плана',{exact:true}).fill(name);await page.getByRole('button',{name:'Сохранить план',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.plan-detail h3').first()).toHaveText(name);
 await page.getByRole('button',{name:'+ Эпик',exact:true}).click();await page.getByLabel('Название в плане',{exact:true}).fill(title);await page.getByRole('button',{name:'Сохранить в плане',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.plan-item-copy strong').filter({hasText:title})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:testInfo.outputPath('planning.png'),fullPage:true});
 await page.getByRole('button',{name:'Канбан',exact:true}).click();await expect(page.locator('.planned-card').filter({hasText:title})).toBeVisible();
 await page.locator('.planned-card').filter({hasText:title}).click();await expect(page.locator('.plan-detail h3').first()).toHaveText(name);
 await page.locator('.plan-item').getByRole('button',{name:'Начать работу',exact:true}).click();await expect(page.locator('.plan-item .plan-state')).toHaveText('В работе');
 await page.getByRole('button',{name:'Канбан',exact:true}).click();await expect(page.locator('.task-card').filter({hasText:title})).toBeVisible();await expect(page.locator('.planned-card').filter({hasText:title})).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('наблюдатель не получает доступ к настройкам подключений Jira', async ({page}) => {
  await login(page, 'browser-viewer@example.invalid', 'disposable-browser-viewer-123');
  const response = await page.request.get('/api/work/jira-imports/sources');
  expect(response.status()).toBe(403);
});

test('соседний раздел комнат открывается с теми же правами пространства', async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page);
  await page.getByRole('button', {name: 'Чат и встречи', exact: true}).click();
  await page.getByRole('button', {name: 'Комнаты', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Комнаты', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: '+ Создать комнату', exact: true})).toBeVisible();
  expect(errors).toEqual([]);
});

test('первые шаги, создание задачи и поиск работают вместе', async ({page}, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page);
  await page.getByRole('button', {name: 'Начать работу', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Начать работу в Контуре'})).toBeVisible();
  const organization = `Проверка ${testInfo.project.name} ${Date.now()}`;
  await page.getByLabel('Название организации', {exact: true}).fill(organization);
  await page.getByRole('button', {name: 'Сохранить название', exact: true}).click();
  await expect(page.getByText('Название сохранено', {exact: true})).toBeVisible({timeout: 15000});
  await page.getByRole('button', {name: 'Создать проект', exact: true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', {name: 'Закрыть окно', exact: true}).click();
  await page.getByRole('button', {name: 'Создать задачу', exact: true}).last().click();
  const title = `Проверка задачи ${testInfo.project.name} ${Date.now()}`;
  await page.getByLabel('Название задачи', {exact: true}).fill(title);
  const savedAt = Date.now();
  await page.getByRole('button', {name: 'Сохранить', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, {timeout: 15000});
  const saveMs = Date.now() - savedAt;
  const boardAt = Date.now();
  await page.getByRole('button', {name: 'Канбан', exact: true}).click();
  await expect(page.getByText(title, {exact: true}).first()).toBeVisible();
  const boardMs = Date.now() - boardAt;
  const searchAt = Date.now();
  await page.getByPlaceholder('Найти задачу…').fill(title);
  await expect(page.locator('.task-card')).toHaveCount(1);
  await expect(page.getByText(title, {exact: true}).first()).toBeVisible();
  await testInfo.attach('timings.json', {body: JSON.stringify({saveMs, boardMs, searchMs: Date.now() - searchAt}), contentType: 'application/json'});
  console.log(`${testInfo.project.name}: сохранение ${saveMs} мс, доска ${boardMs} мс, поиск ${Date.now() - searchAt} мс`);
  expect(errors).toEqual([]);
  await page.goto('/?view=admin&section=imports');
  await expect(page.getByRole('heading', {name: 'Переезд с Jira', exact: true})).toBeVisible({timeout: 15000});
  await page.getByRole('button', {name: 'Подключить Jira', exact: true}).click();
  await expect(page.getByLabel('Вариант Jira')).toHaveValue('data_center');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
