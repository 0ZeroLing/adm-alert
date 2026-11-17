'use strict';
/* ADM 预警系统 - 动态服务端（阿里云轻量应用服务器版）
 * 数据存储在服务器本地 JSON 文件（data/adm-data.json），零第三方依赖
 * 团队共享：所有读写走 /api/*，按星系名行级更新
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = +(process.env.PORT || 8081);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'adm-data.json');

const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');

/* ---------- 本地 JSON 文件存储（原子写） ---------- */
let store = { systems: [], meta: { target: 4.1 } };
let queue = Promise.resolve();   // 串行化写操作，避免并发写坏文件

function loadStore(){
  try{
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const j = JSON.parse(raw);
    store = {
      systems: Array.isArray(j.systems) ? j.systems : [],
      meta: j.meta && typeof j.meta === 'object' ? j.meta : { target: 4.1 }
    };
  }catch(e){ /* 首次运行/文件不存在 → 空库 */ }
}
function persistStore(){
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, DATA_FILE);   // 原子替换
}
function withWrite(fn){
  queue = queue.then(() => {
    const r = fn();
    persistStore();
    return r;
  }).catch(e => { throw e; });
  return queue;
}
loadStore();

/* ---------- 数据行清洗（与前端字段一致） ---------- */
function cleanSys(r){
  if(!r || typeof r.name !== 'string' || !/^[A-Z0-9][A-Z0-9-]{1,9}$/.test(r.name.trim()))
    throw new Error('BAD_NAME');
  const clamp = v => Math.min(100, Math.max(0, +v || 0));
  const lv = v => Math.min(5, Math.max(0, Math.floor(+v || 0)));
  // 每星系独立数据时间：客户端可指定（成员上传时填数据实际时间），缺省=服务器当前时间
  let updAt = r.updAt ? new Date(r.updAt) : new Date();
  if(isNaN(updAt.getTime())) updAt = new Date();
  return {
    name: r.name.trim(),
    milLv: lv(r.milLv), milPct: clamp(r.milPct),
    indLv: lv(r.indLv), indPct: clamp(r.indPct),
    strLv: lv(r.strLv), strPct: clamp(r.strPct),
    capital: !!r.capital,
    note: typeof r.note === 'string' ? r.note.slice(0, 200) : '',
    updAt: updAt.toISOString()
  };
}

const WINGS_PRESET = 'B-7DFU 1B-VKF IP6V-X E-VKJV Q-JQSG QC-YX6 T-M0FA R5-MM8 E3OI-U BX-VEX 8-YNBE LUA5-L T-J6HT T-IPZB YQX-7U K4-RFZ 7G-QIG L-FVHR QY1E-N DG-L7S 39P-1J PS-94K ZA9-PY M5-CGW RKM-GE AJI-MA HZAQ-W HM-XR2 NOL-M9 4-2UXV Q-HESZ F2OY-X 1-SMEB NIDJ-K 6Q-R50 8RQJ-2 RCI-VL MJXW-P D-3GIQ'.split(' ');

/* ---------- 业务 ---------- */
function listAll(){
  return {
    systems: store.systems,
    updDate: store.meta.updDate || '', updTime: String(store.meta.updTime ?? '19'),
    target: +store.meta.target || 4.1
  };
}
function seedIfEmpty(){
  if(store.systems.length) return 0;
  const nowIso = new Date().toISOString();
  store.systems = WINGS_PRESET.map(name => ({
    name, milLv: 5, milPct: 0, indLv: 5, indPct: 0, strLv: 3, strPct: 50,
    capital: false, note: '初始配置，等级指数待填', updAt: nowIso
  }));
  persistStore();
  return store.systems.length;
}

/* ---------- HTTP ---------- */
function send(res, code, obj){
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req){
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; if(buf.length > 1e6) reject(new Error('TOO_LARGE')); });
    req.on('end', () => { try{ resolve(buf ? JSON.parse(buf) : {}); }catch(e){ reject(new Error('BAD_JSON')); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try{
    if(req.method === 'GET' && (p === '/' || p === '/index.html')){
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(INDEX);
    }
    if(!p.startsWith('/api/')) return send(res, 404, { error: 'not found' });

    if(req.method === 'GET' && p === '/api/state'){
      return send(res, 200, listAll());
    }
    if(req.method === 'GET' && p === '/api/meta'){
      return send(res, 200, { updDate: store.meta.updDate || '', updTime: String(store.meta.updTime ?? '19'), target: +store.meta.target || 4.1 });
    }
    if(req.method === 'GET' && p === '/api/seed'){
      return send(res, 200, { seeded: await withWrite(seedIfEmpty) });
    }
    if(req.method === 'POST' && p === '/api/meta'){
      const body = await readBody(req);
      await withWrite(() => {
        if(body.updDate !== undefined) store.meta.updDate = String(body.updDate);
        if(body.updTime !== undefined) store.meta.updTime = String(body.updTime);
        if(body.target !== undefined) store.meta.target = +body.target || 4.1;
      });
      return send(res, 200, { ok: true });
    }
    if(req.method === 'POST' && p === '/api/system'){
      // 新增/编辑星系（按名称 upsert）
      const body = await readBody(req);
      const row = cleanSys(body);
      await withWrite(() => {
        const i = store.systems.findIndex(s => s.name === row.name);
        if(i >= 0) store.systems[i] = row; else store.systems.push(row);
      });
      return send(res, 200, { ok: true });
    }
    if(req.method === 'POST' && p === '/api/systems'){
      // 批量导入（数组）：同名直接更新（含 updAt 数据时间），新名新增
      const body = await readBody(req);
      const arr = Array.isArray(body) ? body : body.systems;
      if(!Array.isArray(arr)) throw new Error('BAD_JSON');
      const rows = arr.map(cleanSys);
      let added = 0, updated = 0;
      await withWrite(() => {
        for(const row of rows){
          const i = store.systems.findIndex(s => s.name === row.name);
          if(i >= 0){ store.systems[i] = row; updated++; }
          else { store.systems.push(row); added++; }
        }
      });
      return send(res, 200, { added, updated });
    }
    if(req.method === 'PATCH' && p === '/api/system'){
      // 改名场景：body.old + 新数据
      const body = await readBody(req);
      const row = cleanSys(body);
      await withWrite(() => {
        if(body.old && body.old !== row.name){
          const i = store.systems.findIndex(s => s.name === String(body.old));
          if(i >= 0) store.systems.splice(i, 1);
        }
        const i = store.systems.findIndex(s => s.name === row.name);
        if(i >= 0) store.systems[i] = row; else store.systems.push(row);
      });
      return send(res, 200, { ok: true });
    }
    if(req.method === 'DELETE' && p === '/api/system'){
      const name = url.searchParams.get('name') || '';
      if(!name) throw new Error('BAD_NAME');
      await withWrite(() => {
        const i = store.systems.findIndex(s => s.name === name);
        if(i >= 0) store.systems.splice(i, 1);
      });
      return send(res, 200, { ok: true });
    }
    if(req.method === 'DELETE' && p === '/api/systems'){
      // 清空全部（含确认，慎用）
      await withWrite(() => {
        store.systems = [];
        store.meta = { target: +store.meta.target || 4.1 };
      });
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'not found' });
  }catch(e){
    const msg = String(e && e.message || e);
    const code = (msg === 'BAD_JSON' || msg === 'BAD_NAME') ? 400 : 500;
    return send(res, code, { error: msg });
  }
});

server.listen(PORT, HOST, () => console.log('ADM alert online at http://' + HOST + ':' + PORT));
