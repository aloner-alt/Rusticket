import type {Env, TelegramTicketRecord} from '../src/types';
import {randomUUID} from 'node:crypto';
import {isRoleKey,ROLE_REQUIREMENTS,MINIMUM_AGE,MINIMUM_DAILY_ONLINE} from '../src/config/requirements';
import {discordRest} from '../src/discord/rest';
import {verifySteamProfile} from '../src/steam/steamClient';
import {createApplicationTicket} from '../src/handlers/ticketService';
import {getRecruitmentState,getActiveApplication,getActiveApplicationBySteam,getUserBan,getSteamBan} from '../src/storage/applications';

export async function createTelegramApplication(env:Env,data:Record<string,unknown>):Promise<TelegramTicketRecord> {
  const str=(key:string):string=>typeof data[key]==='string'?data[key]:'';
  const discordId=str('discordUserId'),tgId=str('telegramUserId'),role=str('role'),realName=str('realName').trim(),description=str('description').trim();
  const age=Number(str('age')),online=Number(str('dailyOnline'));
  if(!/^\d{17,20}$/.test(discordId)||!/^\d{3,20}$/.test(tgId)) throw new Error('Укажите обязательный Discord ID.');
  if(!isRoleKey(role)||realName.length<2||realName.length>80||description.length<5||description.length>1000) throw new Error('Проверьте имя, направление и описание анкеты.');
  if(!Number.isInteger(age)||age<MINIMUM_AGE||age>100||!Number.isFinite(online)||online<MINIMUM_DAILY_ONLINE||online>24) throw new Error('Требования: возраст от 15 лет, онлайн от 6 часов в день.');
  // Do not create tickets in the staging SQLite while Discord still uses Worker KV.
  if(process.env.DISCORD_GATEWAY_ENABLED!=='true') throw new Error('Отправка временно недоступна: завершается перенос базы заявок. Анкета сохранена до перезапуска бота.');
  const recruitment=await getRecruitmentState(env);
  if(!recruitment.open) throw new Error('Набор сейчас закрыт.');
  if(await getUserBan(env,discordId)) throw new Error('Подача заявок для этого Discord временно ограничена.');
  if(await getActiveApplication(env,discordId)) throw new Error('У этого Discord уже есть заявка.');
  const member=await discordRest<{user?:{username:string;bot?:boolean}}>(env,`/guilds/${env.DISCORD_GUILD_ID}/members/${discordId}`).catch(()=>null);
  if(!member?.user||member.user.bot) throw new Error('Discord-пользователь должен состоять на сервере клана. Проверьте ID.');
  const steam=await verifySteamProfile(str('steamUrl'),env.STEAM_API_KEY);
  if(!steam.ok) throw new Error('Не удалось проверить Steam. Откройте профиль и игровую статистику Rust и проверьте ссылку.');
  if(await getSteamBan(env,steam.steamId64)) throw new Error('Подача заявок для этого Steam временно ограничена.');
  if(await getActiveApplicationBySteam(env,steam.steamId64)) throw new Error('У этого Steam уже есть заявка.');
  const requiredHours=ROLE_REQUIREMENTS[role].minimumRustHours;
  if(steam.rustHours<requiredHours) throw new Error(`Для этого направления требуется ${requiredHours} часов Rust; найдено ${steam.rustHours}.`);
  const app=await createApplicationTicket(env,{applicantId:discordId,applicantUsername:member.user.username,realName,age,dailyOnline:online,role,steamUrl:steam.profileUrl,steamId64:steam.steamId64,steamName:steam.steamName,rustHours:steam.rustHours,requiredHours,applicantComment:`📱 Источник: Telegram, ID ${tgId}\n${description}`,...(recruitment.additionalCriteria?.[role]?{additionalQuestion:recruitment.additionalCriteria[role],additionalAnswer:description}:{})});
  const record:TelegramTicketRecord={id:randomUUID(),telegramUserId:tgId,telegramUsername:str('telegramUsername'),discordUserId:discordId,description:`${realName}, ${age} лет · ${role} · ${online} ч./день\nSteam: ${steam.profileUrl}\nRust: ${steam.rustHours} ч.\n${description}`,ticketChannelId:app.ticketChannelId,cardMessageId:app.cardMessageId,status:app.status,createdAt:app.createdAt};
  await env.APPLICATIONS.put('telegram-ticket:'+record.id,JSON.stringify(record));
  return record;
}
