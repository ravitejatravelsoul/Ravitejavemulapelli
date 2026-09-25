import { test } from "node:test";
import assert from "node:assert/strict";
import { movePlayer, canStand } from "../../../../components/ai-office/world-prototype/world-model.ts";

test("Boss approaches from several angles without collision and can slide away", () => {
 for (const angle of [0, Math.PI/4, Math.PI/2, Math.PI, -Math.PI/2]) {
  const clear = (x:number,z:number)=>Math.hypot(x,z-15)>.82;
  let x= Math.cos(angle)*2.3,z=15+Math.sin(angle)*2.3;
  assert.ok(canStand(x,z));
  for(let i=0;i<70;i++) {
   [x,z]=movePlayer(x,z,-Math.cos(angle)*.06,-Math.sin(angle)*.06,clear);
   assert.ok(clear(x,z),"no intersection");
  }
  assert.ok(Math.hypot(x,z-15)<2.6,"reachable greeting distance");
  const before=[x,z];
  [x,z]=movePlayer(x,z,Math.cos(angle)*.5-Math.sin(angle)*.5,Math.sin(angle)*.5+Math.cos(angle)*.5,clear);
  assert.ok(Math.hypot(x-before[0],z-before[1])>.1,"not trapped");
 }
});
test("large frame displacement cannot tunnel through another actor",()=>{
 const clear=(x:number,z:number)=>Math.hypot(x,z-15)>.82;
 const [x,z]=movePlayer(-2,15,4,0,clear);
 assert.ok(x<-.82 && clear(x,z));
});
