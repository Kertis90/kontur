import {test,expect} from '@playwright/test';
import {login} from './session.mjs';
// Открывает конструктор после настоящей авторизации на одноразовом стенде.
async function openAgents(page){await login(page);await page.getByRole('button',{name:'ИИ-агенты',exact:true}).click();await page.getByRole('combobox',{name:'Проект',exact:true}).selectOption({label:'Запуск Nova'});}
test('библиотека сохраняет часть и добавляет закреплённую версию',async({page},testInfo)=>{
 await openAgents(page);await page.getByRole('button',{name:'+ Создать агента',exact:true}).click();await page.getByRole('complementary',{name:'Библиотека блоков'}).getByRole('button',{name:'Собрать текст',exact:false}).click();
 await page.getByRole('button',{name:'Библиотека общих частей',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Общие части сценариев'}),name=`Часть ${testInfo.project.name} ${Date.now()}`;
 await dialog.getByLabel('Название общей части',{exact:true}).fill(name);await dialog.getByRole('button',{name:'Сохранить версию',exact:true}).click();const part=dialog.locator('article').filter({hasText:name});await expect(part).toBeVisible();await part.getByRole('button',{name:'Добавить версию 1',exact:true}).click();await expect(page.locator('.studio-node-part')).toContainText('закреплена версия 1');
 await page.getByRole('button',{name:'Вписать',exact:true}).click();const node=page.locator('[data-node-id="step_2"]'),before=await node.getAttribute('style'),box=await node.locator('.canvas-node-handle').boundingBox();await page.mouse.move(box.x+40,box.y+30);await page.mouse.down();await page.mouse.move(box.x+70,box.y+50,{steps:4});await page.mouse.up();await expect(node).not.toHaveAttribute('style',before);await page.screenshot({path:testInfo.outputPath('shared-agent-part.png'),fullPage:true});
});
test('редактор открывает фактические входы прошлого запуска на схеме',async({page},testInfo)=>{
 await openAgents(page);const card=page.locator('.agent-card').filter({hasText:'Проверка журнала'}).first();await expect(card).toBeVisible();await card.getByRole('button',{name:'Настроить',exact:true}).click();await page.getByText('Проверка по предыдущему запуску',{exact:true}).click();
 const select=page.getByRole('combobox',{name:'Данные запуска',exact:true});await expect(select.locator('option')).not.toHaveCount(1);const id=await select.locator('option').nth(1).getAttribute('value');await select.selectOption(id);await expect(page.locator('.agent-step-details')).toContainText('Вход блока');await expect(page.locator('.agent-step-details')).toContainText('Результат блока');await expect(page.locator('.agent-step-details')).toContainText('source_ids');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:testInfo.outputPath('agent-debug-editor.png'),fullPage:true});
});
