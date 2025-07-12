import './config.js';
import { createRequire } from "module";
import path, { join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { platform } from 'process';
import * as ws from 'ws';
import { readdirSync, statSync, unlinkSync, existsSync, readFileSync, watch } from 'fs';
import yargs from 'yargs';
import { spawn } from 'child_process';
import lodash from 'lodash';
import chalk from 'chalk';
import syntaxerror from 'syntax-error';
import { tmpdir } from 'os';
import { format } from 'util';
import P from 'pino';
import qrcode from 'qrcode-terminal';
import { makeWASocket, protoType, serialize } from './lib/simple.js';
import { Low, JSONFile } from 'lowdb';
import { mongoDB, mongoDBV2 } from './lib/mongoDB.js';
import store from './lib/store.js';

const { useSingleFileAuthState, DisconnectReason } = await import('@adiwajshing/baileys');
const { CONNECTING } = ws;
const { chain } = lodash;
const PORT = process.env.PORT || process.env.SERVER_PORT || 3000;

protoType();
serialize();

global.__filename = function filename(pathURL = import.meta.url, rmPrefix = platform !== 'win32') {
  return rmPrefix ? /file:\/\//.test(pathURL) ? fileURLToPath(pathURL) : pathURL : pathToFileURL(pathURL).toString();
};
global.__dirname = function dirname(pathURL) {
  return path.dirname(global.__filename(pathURL, true));
};
global.__require = function require(dir = import.meta.url) {
  return createRequire(dir);
};

global.API = (name, path = '/', query = {}, apikeyqueryname) =>
  (name in global.APIs ? global.APIs[name] : name) + path +
  (query || apikeyqueryname ? '?' + new URLSearchParams(Object.entries({
    ...query,
    ...(apikeyqueryname ? { [apikeyqueryname]: global.APIKeys[name in global.APIs ? global.APIs[name] : name] } : {})
  })) : '');

global.timestamp = { start: new Date };
const __dirname = global.__dirname(import.meta.url);

global.opts = new Object(yargs(process.argv.slice(2)).exitProcess(false).parse());
global.prefix = new RegExp('^[' + (opts['prefix'] || 'xzXZ/i!#$%+£¢€¥^°=¶∆×÷π√✓©®:;?&.\\-HhhHBb.aA').replace(/[|\\{}()[\]^$+*?.\-^]/g, '\\$&') + ']');

const dbAdapter = /https?:\/\//.test(opts['db'] || '')
  ? new cloudDBAdapter(opts['db'])
  : /mongodb(\+srv)?:\/\//i.test(opts['db'])
    ? (opts['mongodbv2'] ? new mongoDBV2(opts['db']) : new mongoDB(opts['db']))
    : new JSONFile(`${opts._[0] ? opts._[0] + '_' : ''}database.json`);

global.db = new Low(dbAdapter);
global.DATABASE = global.db;

global.loadDatabase = async function loadDatabase() {
  if (global.db.READ) return new Promise((resolve) => {
    const i = setInterval(async function () {
      if (!global.db.READ) {
        clearInterval(i);
        resolve(global.db.data == null ? global.loadDatabase() : global.db.data);
      }
    }, 1000);
  });
  if (global.db.data !== null) return;
  global.db.READ = true;
  await global.db.read().catch(console.error);
  global.db.READ = null;
  global.db.data = {
    users: {},
    chats: {},
    stats: {},
    msgs: {},
    sticker: {},
    settings: {},
    ...(global.db.data || {})
  };
  global.db.chain = chain(global.db.data);
};

await loadDatabase();

global.authFile = `${opts._[0] || 'session'}.data.json`;
const { state, saveState } = useSingleFileAuthState(global.authFile);

const connectionOptions = {
  printQRInTerminal: true,
  auth: state,
  logger: P({ level: 'silent' }),
  browser: ['TheMystic-Bot', 'Edge', '1.0.0'],
  getMessage: async (key) => {
    const remoteJid = key.remoteJid.includes(':') ? key.remoteJid.split(':')[0] + '@s.whatsapp.net' : key.remoteJid;
    return await store.loadMessage(remoteJid, key.id);
  }
};

global.conn = makeWASocket(connectionOptions);
global.conn.isInit = false;

conn.ev.on('connection.update', async (update) => {
  const { connection, lastDisconnect, isNewLogin, qr } = update;

  if (qr) {
    console.clear();
    console.log('\n🟨 Escanea este código QR con tu WhatsApp:\n');
    qrcode.generate(qr, { small: true });
  }

  if (isNewLogin) conn.isInit = true;
  const code = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode;
  if (code && code !== DisconnectReason.loggedOut && conn?.ws.readyState !== CONNECTING) {
    console.log(await global.reloadHandler(true).catch(console.error));
    global.timestamp.connect = new Date;
  }

  if (global.db.data == null) await loadDatabase();

  if (connection === 'open') {
    console.log(chalk.yellow(`
▣─────────────────────────────···
│
│  ✅ Conectado correctamente a WhatsApp
│
▣─────────────────────────────···`));
  }
});

