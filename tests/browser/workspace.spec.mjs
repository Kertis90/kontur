import {test, expect} from '@playwright/test';

// Выполняет реальный вход на одноразовом стенде через пользовательскую форму.
async function login(page, email = 'browser-owner@example.invalid', password = 'disposable-browser-owner-123') {
  await page.goto('/');
  await page.getByLabel('Электронная почта или логин', {exact: true}).fill(email);
  await page.getByLabel('Пароль', {exact: true}).fill(password);
  await page.getByRole('button', {name: 'Войти', exact: true}).click();
  await expect(page.getByPlaceholder('Найти задачу…')).toBeVisible({timeout: 60000});
}

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
