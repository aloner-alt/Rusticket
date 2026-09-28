export const roles = ['combat','farm','builder','industrial','electric','pilot'];
export const questions = [
  ['discordUserId','1/7. Укажите Discord ID (17–20 цифр). Discord обязателен, вы должны состоять на сервере клана.'],
  ['realName','2/7. Как вас зовут?'],
  ['age','3/7. Сколько вам лет?'],
  ['role','4/7. Выберите направление: combat, farm, builder, industrial, electric или pilot.'],
  ['steamUrl','5/7. Отправьте ссылку на ваш Steam-профиль. Откройте профиль и игровую статистику для проверки часов Rust.'],
  ['dailyOnline','6/7. Сколько часов в день готовы играть?'],
  ['description','7/7. Расскажите об опыте и навыках по выбранному направлению.']
];
export function validateAnswer(key,value) {
  if(key==='discordUserId'&&!/^\d{17,20}$/.test(value)) return 'Нужен Discord ID из 17–20 цифр. Без Discord заявка невозможна.';
  if(key==='realName'&&(value.length<2||value.length>80)) return 'Имя: от 2 до 80 символов.';
  if(key==='age'&&(!/^\d+$/.test(value)||Number(value)<15||Number(value)>100)) return 'Для набора требуется возраст от 15 лет. Введите возраст числом.';
  if(key==='role'&&!roles.includes(value)) return 'Выберите направление кнопкой ниже.';
  if(key==='steamUrl'&&!/^https:\/\/steamcommunity\.com\/(id|profiles)\/[A-Za-z0-9_-]+\/?$/.test(value)) return 'Нужна ссылка https://steamcommunity.com/id/... или /profiles/...';
  if(key==='dailyOnline'&&(!/^\d+(\.\d+)?$/.test(value)||Number(value)<6||Number(value)>24)) return 'Требуется от 6 часов в день. Введите число от 6 до 24.';
  if(key==='description'&&(value.length<5||value.length>1000)) return 'Расскажите о себе: от 5 до 1000 символов.';
  return null;
}
