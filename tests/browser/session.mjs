import {expect} from '@playwright/test';
const sessions=new Map();

// Входит через настоящую форму один раз для каждой роли и повторно использует cookies в изолированных контекстах тестов.
export async function login(page,email='browser-owner@example.invalid',password='disposable-browser-owner-123'){
 const saved=sessions.get(email);
 if(saved)await page.context().addCookies(saved);
 await page.goto('/');
 if(!saved){
  await page.getByLabel('Электронная почта или логин',{exact:true}).fill(email);
  await page.getByLabel('Пароль',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Войти',exact:true}).click();
 }
 await expect(page.getByPlaceholder('Найти задачу…')).toBeVisible({timeout:60000});
 if(!saved)sessions.set(email,await page.context().cookies());
}
