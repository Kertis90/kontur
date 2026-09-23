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
  await expect(page.getByText('Источники и параметры', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Увеличить масштаб'}).click();
  await expect(page.getByLabel('Масштаб', {exact: true})).toHaveText('90%');
  await page.getByRole('button', {name: 'Вписать', exact: true}).click();
  expect(Number((await page.getByLabel('Масштаб', {exact: true}).textContent()).replace('%', ''))).toBeGreaterThan(60);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({path: testInfo.outputPath('agent-canvas.png'), fullPage: true});
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
