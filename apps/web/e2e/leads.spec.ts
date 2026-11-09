import ExcelJS from 'exceljs';
import { type Page, expect, test } from '@playwright/test';

const PASSWORD = '123456';
const SHOTS = process.env.E2E_SHOTS_DIR;

async function login(page: Page, login: string) {
  await page.goto('/login');
  await page.getByLabel('Login').fill(login);
  await page.getByLabel('Parol', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Kirish' }).click();
  await expect(page.getByRole('navigation', { name: 'Asosiy menyu' })).toBeVisible();
}

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

/** "Baza operator uchun.xlsx" ko'rinishida (ruscha sarlavhalar) */
async function baseFile() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('21-10-2026');
  ws.addRow(['N', 'ИНН', 'Название', 'Дата регистрации', 'Директор', 'Рабочий телефон', 'Домашний телефон', 'Телефон', 'Адрес']);
  ws.addRow(['1', '501000001', '"E2E SULTAN" MCHJ', '07.10.2026', 'ZUBENKO ALEKSANDR', null, null, null, 'Oq uy MFY']);
  ws.addRow(['2', '501000002', '"E2E BAKER" MCHJ', '07.10.2026', 'SHAROPOV AKMAL', null, null, '998901855999', "Chimkent ko'chasi"]);
  ws.addRow(['3', '305123456', 'SHERPROM STROY MChJ', '01.01.2020', null, null, null, null, null]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('operator: rahbar baza yuklaydi, operator qo\'ng\'iroq qiladi, "Mijoz bo\'ldi" — rahbar mijozga aylantiradi', async ({ browser }) => {
  // Rahbar: Excel yuklash (avval tekshirish)
  const leadCtx = await browser.newContext();
  const leader = await leadCtx.newPage();
  await login(leader, 'rahbar');
  await leader.getByRole('link', { name: 'Yangi mijozlar' }).click();
  await leader.getByRole('button', { name: 'Excel yuklash' }).click();
  const imp = leader.getByRole('dialog');
  await imp.locator('input[type=file]').setInputFiles({ name: 'Baza operator uchun.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await baseFile() });
  await imp.getByRole('button', { name: 'Tekshirish' }).click();
  await expect(imp.getByText('Allaqachon mijozimiz')).toBeVisible();
  await shot(leader, '1-import-dry-run');
  await imp.getByRole('button', { name: 'Yuklash' }).click();
  await expect(leader.getByText("2 ta firma operator ro'yxatiga qo'shildi")).toBeVisible();

  // Operator: faqat "Yangi mijozlar" ko'radi; buxgalteriya sahifalari yopiq
  const opCtx = await browser.newContext();
  const op = await opCtx.newPage();
  await login(op, 'operator');
  await expect(op).toHaveURL(/\/leads/);
  await expect(op.getByRole('link', { name: 'Hisobot topshirish' })).toHaveCount(0);
  await op.goto('/clients');
  await expect(op).toHaveURL(/\/leads/);
  await expect(op.getByText('"E2E SULTAN" MCHJ')).toBeVisible();
  await shot(op, '2-operator-today');

  // Javob bermadi -> raqam kiritish -> keyinroq qiling
  await op.getByText('"E2E SULTAN" MCHJ').click();
  let dlg = op.getByRole('dialog');
  await dlg.getByLabel('Telefon').fill('+998901112233');
  await dlg.getByRole('button', { name: 'Saqlash' }).first().click();
  await dlg.getByRole('radio', { name: 'Keyinroq qiling' }).click();
  await dlg.getByLabel('Izoh').fill('Dushanba kuni qiling, direktor safarda');
  await shot(op, '3-operator-call');
  await dlg.getByRole('button', { name: 'Saqlash' }).last().click();
  await expect(dlg).toBeHidden();

  // Ikkinchi firma: mijoz bo'ldi -> rahbarga o'tadi va operator ro'yxatidan yo'qoladi
  await op.getByText('"E2E BAKER" MCHJ').click();
  dlg = op.getByRole('dialog');
  await dlg.getByRole('radio', { name: "Mijoz bo'ldi" }).click();
  await dlg.getByLabel('Izoh').fill('Shartnomaga rozi, ertaga hujjatlar');
  await dlg.getByRole('button', { name: "Rahbarga o'tkazish" }).click();
  await expect(op.getByText("Rahbarga o'tkazildi")).toBeVisible();
  await op.getByRole('tab', { name: /Hammasi/ }).click();
  await expect(op.getByText('"E2E SULTAN" MCHJ')).toBeVisible();
  await expect(op.getByText('"E2E BAKER" MCHJ')).toHaveCount(0);

  // Rahbar: bildirishnoma, "Mijoz bo'ldi" bo'limi, mijozga aylantirish
  await expect(leader.locator('[data-sonner-toast]').filter({ hasText: 'Yangi mijoz topildi: "E2E BAKER" MCHJ' })).toBeVisible({ timeout: 10_000 });
  await leader.reload();
  await leader.getByRole('tab', { name: /Mijoz bo'ldi/ }).click();
  await shot(leader, '4-leader-won');
  await leader.getByText('"E2E BAKER" MCHJ').click();
  await expect(leader.getByRole('dialog').getByText('Shartnomaga rozi, ertaga hujjatlar')).toBeVisible();
  await shot(leader, '5-leader-lead-card');
  await leader.getByRole('button', { name: 'Mijozga aylantirish' }).click();
  const conv = leader.getByRole('dialog');
  await expect(conv.getByRole('heading', { name: /Mijozga aylantirish/ })).toBeVisible();
  await expect(conv.getByLabel('STIR')).toHaveValue('501000002');
  await conv.getByLabel('Javobgar buxgalter').click();
  await leader.getByRole('option', { name: /Aziza Karimova/ }).click();
  await conv.getByRole('button', { name: 'Yaratish' }).click();
  await expect(leader).toHaveURL(/\/clients\/\d+$/);
  await expect(leader.getByRole('heading', { name: '"E2E BAKER" MCHJ' })).toBeVisible();

  await opCtx.close();
  await leadCtx.close();
});
