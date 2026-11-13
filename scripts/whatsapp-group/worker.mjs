/** Persistent local WhatsApp sender. Credentials, invitations and sessions stay outside Git. */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { inviteCode, apiUrl, selectAlerts, sendPending, isGroupId } from "./alerts.mjs";
const require = createRequire(import.meta.url);
const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const root = path.resolve(import.meta.dirname, "../..");
const runtime = path.join(root, ".whatsapp-alerts");
const config = JSON.parse(fs.readFileSync(path.join(runtime, "config.private.json"), "utf8"));
if (!/^[0-9]{8,15}$/.test(config.sender_phone)) throw new Error("Invalid sending number");
const code = inviteCode(config.group_invite_url);
const stateFile = path.join(runtime, "delivery.private.json");
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
function persist(value) { const tmp = `${stateFile}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value), { mode:0o600 }); fs.renameSync(tmp, stateFile); }
const status = { state:"starting", sender:`+${config.sender_phone}`, group:null, code:null, qr:null, last_poll:null, last_accepted:null, last_delivered:null, source_errors:[], error:null };
const port = Number(process.env.WHATSAPP_LINK_PORT || 8788);
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Link ZINGSA WhatsApp alerts</title>
<style>body{font:17px system-ui;background:#081522;color:#e3f0fa;max-width:720px;margin:40px auto;padding:20px}h1{font-size:28px}p{line-height:1.7;color:#b9cedd}#code{font-size:40px;letter-spacing:5px;font-weight:bold;color:#8ee1b6}img{max-width:280px;background:white;padding:16px;border-radius:10px}article{padding:24px;background:#10283b;border-radius:16px}small{color:#99b7ca}</style>
<h1>ZINGSA WhatsApp group alerts</h1><article><p id="state">Connecting...</p><p id="sender"></p><div id="code"></div><img id="qr" hidden><p>On the sending phone, open <strong>WhatsApp → Linked devices → Link a device → Link with phone number instead</strong>, then enter the code above. If a QR code is shown, scan it from Linked devices.</p><p id="group"></p><p id="error"></p><p id="delivery"></p></article><p>This computer and the sender process must remain running for automatic group delivery. Alert delivery starts only after the correct account and group are verified.</p><small>This local page refreshes automatically. No login codes or account session files are sent to the public website.</small>
<script>async function refresh(){try{const s=await fetch('/status',{cache:'no-store'}).then(r=>r.json());document.getElementById('state').textContent='Status: '+s.state;document.getElementById('sender').textContent='Sending account: '+s.sender;document.getElementById('code').textContent=s.code||'';const q=document.getElementById('qr');q.hidden=!s.qr;if(s.qr)q.src=s.qr;document.getElementById('group').textContent=s.group?'Group: '+s.group:'';document.getElementById('error').textContent=s.error||s.source_errors.join('; ');document.getElementById('delivery').textContent=s.last_delivered?'Last delivered: '+s.last_delivered:s.last_accepted?'Last accepted by WhatsApp: '+s.last_accepted:'No messages sent yet.'}catch{document.getElementById('state').textContent='Sender process unavailable.'}}refresh();setInterval(refresh,2500);</script>`;
const server = http.createServer((req,res) => {
  if (!["127.0.0.1", "localhost"].includes((req.headers.host ?? "").split(":")[0])) { res.writeHead(403).end(); return; }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  if (req.method !== "GET") { res.writeHead(405).end(); return; }
  if(req.url === "/status") { res.setHeader("Content-Type", "application/json");res.end(JSON.stringify(status)); }
  else if(req.url === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8");res.end(html); }
  else res.writeHead(404).end();
});
server.listen(port,"127.0.0.1",()=>console.log(`WhatsApp connection page: http://127.0.0.1:${port}`));
const browser = process.env.WHATSAPP_BROWSER_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
const client = new Client({
  authStrategy:new LocalAuth({clientId:"zingsa-alerts",dataPath:path.join(runtime,"auth")}),
  webVersionCache:{type:"local",path:path.join(runtime,"cache")},
  puppeteer:{headless:true,...(browser?{executablePath:browser}:{}),args:["--disable-dev-shm-usage"]},
  pairWithPhoneNumber:{phoneNumber:config.sender_phone,showNotification:true,intervalMs:180000},
  deviceName:"ZINGSA group alert sender", authTimeoutMs:120000,
});
let groupId = null, polling = false, timer;
client.on("code", value=>{status.code=value;status.qr=null;status.state="Awaiting approval on the sending phone";console.log("Phone linking code ready on local connection page.");});
client.on("qr", async value=>{status.qr=await QRCode.toDataURL(value);status.state="Awaiting QR approval on sending phone";});
client.on("authenticated",()=>{status.code=null;status.qr=null;status.state="Account linked; verifying sender and group";});
client.on("auth_failure",()=>{status.state="Authentication failed";status.error="Reconnect the sending account using Linked devices.";});
client.on("disconnected",()=>{status.state="Disconnected";groupId=null;status.error="Group delivery is paused until the sender reconnects.";if(timer)clearInterval(timer);});
client.on("message_ack",(message,ack)=>{
  for(const row of Object.values(state.messages ?? {})) if(row.id===message.id._serialized) {
    row.ack=ack;
    if(ack>=2) {row.delivered_at=new Date().toISOString();status.last_delivered=row.delivered_at;}
    persist(state);break;
  }
});
async function readSource(route) {
  const response=await fetch(apiUrl(config.api_base,route), {headers:process.env.API_KEY?{"X-API-Key":process.env.API_KEY}:{},signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw new Error(`Source unavailable: ${route} (HTTP ${response.status})`);
  return response.json();
}
async function poll() {
  if(polling || !groupId || !config.enabled)return;
  polling=true;
  try {
    const results=await Promise.allSettled([readSource("/space-weather/early-warning"),readSource("/gic/assessment")]);
    status.source_errors=results.filter(r=>r.status==="rejected").map(r=>r.reason?.message ?? "Source request failed");
    const alerts=selectAlerts(results[0].status==="fulfilled"?results[0].value:null,results[1].status==="fulfilled"?results[1].value:null);
    await sendPending(alerts,state,{groupId,send:(id,text)=>client.sendMessage(id,text,{sendSeen:false}),persist:async value=>{persist(value);status.last_accepted=new Date().toISOString();}});
    status.error=null;
    status.last_poll=new Date().toISOString();
    status.state=status.source_errors.length?"Linked; one or more alert sources unavailable":"Connected; watching for new group alerts";
  } catch(error) { status.error="Alert delivery failed; unaccepted alerts remain eligible for retry.";console.error(error.message); }
  finally {polling=false;}
}
client.on("ready",async()=>{
  try {
    if(client.info?.wid?.user!==config.sender_phone)throw new Error("The linked account does not match the configured sending number. Delivery remains disabled.");
    const info=await client.getInviteInfo(code);
    const candidate=info?.id?._serialized ?? info?.id;
    if(!isGroupId(candidate))throw new Error("WhatsApp could not resolve the supplied invitation to a group.");
    // An existing member can use the chat directly; otherwise use the supplied invitation.
    let chat=(await client.getChats()).find(chat=>chat.isGroup && chat.id._serialized===candidate);
    if(!chat?.isGroup) { await client.acceptInvite(code);chat=await client.getChatById(candidate); }
    if(!chat?.isGroup)throw new Error("Group membership is not ready; administrator approval may be required.");
    groupId=candidate;status.group=chat.name || info.subject || "Configured WhatsApp group";status.error=null;
    status.state="Connected; watching for new group alerts";
    console.log("Verified sending account and configured group. Automatic alert polling enabled.");
    await poll();timer=setInterval(()=>void poll(),Math.max(30,Number(config.poll_seconds)||60)*1000);
  } catch(error) {status.state="Account linked; group setup incomplete";status.error=error.message;groupId=null;}
});
client.initialize().catch(error=>{status.state="Connection failed";status.error="WhatsApp Web could not initialize. Check the local sender log.";console.error(error.message);});
async function stop(){if(timer)clearInterval(timer);await client.destroy().catch(()=>{});server.close();process.exit(0);}
process.on("SIGINT",stop);process.on("SIGTERM",stop);
