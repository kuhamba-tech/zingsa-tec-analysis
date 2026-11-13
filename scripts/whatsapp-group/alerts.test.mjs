import test from "node:test";
import assert from "node:assert/strict";
import { inviteCode, apiUrl, selectAlerts, sendPending } from "./alerts.mjs";

const now = Date.parse("2026-11-09T12:00:00Z");
const observation = { alert_id:"test", status:"watch", severity:"watch", authority:"zingsa_experimental", observation_time:"2026-11-09T11:55:00Z", title:"Driver watch", message:"Sustained speed", source:"NOAA SWPC", observed_value:600, unit:"km/s" };
test("Vercel routes use the existing group dispatchers", () => {
  assert.equal(apiUrl("https://example.vercel.app", "/space-weather/early-warning").searchParams.get("__zr"), "/space-weather/early-warning");
  assert.equal(apiUrl("https://example.vercel.app", "/gic/assessment").pathname, "/api/core-router");
});
test("invitation links are validated without storing personal destinations in source", () => {
  assert.equal(inviteCode("https://chat.whatsapp.com/AbcDef0123456789AbcDef?s=sh"), "AbcDef0123456789AbcDef");
  assert.throws(() => inviteCode("https://example.org/group"));
});
test("only current genuine alerts are selected and experimental watches stay labelled", () => {
  const alerts = selectAlerts({ active:[observation, {...observation, alert_id:"old", observation_time:"2020-01-01T00:00:00Z"}, {...observation, alert_id:"resolved", status:"resolved"}] }, null, {now});
  assert.equal(alerts.length,1);
  assert.match(alerts[0].text,/does not confirm a geomagnetic storm/);
  assert.match(alerts[0].text,/600 km\/s/);
});
test("missing or provisional GIC never becomes an operational message", () => {
  const gic={ stations:[{station_id:"DEMA_001", observed_alerts:[{fresh:true, provisional:true, engineering_action_authorized:false, time:observation.observation_time, current_a:40}]}] };
  assert.deepEqual(selectAlerts(null,gic,{now}),[]);
  assert.deepEqual(selectAlerts({active:[]},{stations:[]},{now}),[]);
});
test("accepted messages are deduplicated and sent to the group, never members", async () => {
  const state={}; const calls=[]; let writes=0;
  const args={groupId:"123456789-123@g.us", send:async(id,text)=>{calls.push({id,text});return {id:{_serialized:"msg-1"},ack:1}},persist:async()=>{writes++},now};
  const rows=[{key:"one",text:"Test-only fixture"}];
  await sendPending(rows,state,args); await sendPending(rows,state,args);
  assert.equal(calls.length,1); assert.equal(writes,1); assert.equal(calls[0].id,args.groupId);
});
test("failed sends remain eligible and individual recipients are rejected", async () => {
  const state={};
  await assert.rejects(sendPending([{key:"one",text:"fixture"}],state,{groupId:"123@g.us",send:async()=>{throw new Error("disconnected")},persist:async()=>{},now}));
  assert.deepEqual(state.messages,{});
  await assert.rejects(sendPending([],state,{groupId:"263000000000@c.us"}));
});
