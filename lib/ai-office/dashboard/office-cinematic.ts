/** Stable layered layout from the actual DAG, never from a canned role sequence. */
export function layoutOfficeDag(nodes:Array<{id:string;dependsOn:string[]}>) {
 const pending=new Map(nodes.map(n=>[n.id,n]));const levels=new Map<string,number>();
 for(let pass=0;pending.size&&pass<=nodes.length;pass++){
  let progressed=false;
  for(const [id,node] of pending){if(node.dependsOn.every(d=>levels.has(d)||!nodes.some(n=>n.id===d))){levels.set(id,Math.max(-1,...node.dependsOn.map(d=>levels.get(d)??-1))+1);pending.delete(id);progressed=true;}}
  if(!progressed)break;
 }
 const invalid=pending.size>0;for(const id of pending.keys())levels.set(id,0);
 const groups=new Map<number,string[]>();for(const node of nodes){const level=levels.get(node.id)!;groups.set(level,[...(groups.get(level)??[]),node.id]);}
 const maxRows=Math.max(1,...[...groups.values()].map(g=>g.length));
 return {invalid,width:Math.max(640,(Math.max(0,...levels.values())+1)*210+40),height:maxRows*105+40,
  positions:Object.fromEntries(nodes.map(n=>{const group=groups.get(levels.get(n.id)!)!;return [n.id,{x:30+levels.get(n.id)!*210,y:30+(group.indexOf(n.id)+(maxRows-group.length)/2)*105}];})) as Record<string,{x:number;y:number}>};
}
export function eligibleOfficeMoment(input:{plannedAt:number|null;plannedEventId:string|null;verifiedDelivery:boolean;transitions:Array<{id:string;type:string;occurredAt:number}>},now:number) {
 const delivery=input.verifiedDelivery?input.transitions.filter(t=>t.type==='DELIVERY').at(-1):undefined;
 if(delivery && now>=delivery.occurredAt && now-delivery.occurredAt<8000)return {id:delivery.id,type:'DELIVERY' as const};
 if(input.plannedAt!==null&&input.plannedEventId&&now>=input.plannedAt&&now-input.plannedAt<8000)return {id:input.plannedEventId,type:'START' as const};
 return null;
}
