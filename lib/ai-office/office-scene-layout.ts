/** Native artwork coordinates: character, monitor and labels share one viewBox. */
export interface WorkstationGeometry {
  head: { cx: number; cy: number; rx: number; ry: number };
  screen: string;
  label: [number, number];
  shortName: string;
}
export const WORKSTATIONS: Record<string, WorkstationGeometry> = {
  "product-owner": { head: {cx:249,cy:158,rx:20,ry:19}, screen:"96,100 237,86 237,167 96,192",label:[200,277],shortName:"Product Owner" },
  "research-agent": {head:{cx:110,cy:362,rx:30,ry:25},screen:"145,334 214,346 213,405 145,389",label:[172,509],shortName:"Research"},
  "solution-architect": {head:{cx:516,cy:288,rx:25,ry:21},screen:"398,250 495,233 496,315 398,335",label:[484,416],shortName:"Architect"},
  orchestrator: {head:{cx:836,cy:210,rx:27,ry:24},screen:"786,144 899,143 898,218 786,222",label:[837,425],shortName:"Chief of Staff"},
  "ui-ux-agent": {head:{cx:1142,cy:216,rx:22,ry:22},screen:"1127,153 1234,174 1233,229 1127,207",label:[1168,356],shortName:"UI / UX"},
  "qa-agent": {head:{cx:1446,cy:267,rx:25,ry:23},screen:"1468,214 1578,229 1578,310 1468,288",label:[1477,357],shortName:"QA"},
  "security-reviewer": {head:{cx:1516,cy:432,rx:27,ry:23},screen:"1395,370 1455,360 1455,450 1395,462",label:[1490,564],shortName:"Security"},
  "frontend-developer": {head:{cx:638,cy:542,rx:28,ry:25},screen:"588,484 665,473 665,545 588,552",label:[645,708],shortName:"Frontend"},
  "backend-developer": {head:{cx:1032,cy:538,rx:26,ry:24},screen:"1007,474 1081,477 1081,541 1007,535",label:[1040,712],shortName:"Backend"},
  "code-reviewer": {head:{cx:222,cy:687,rx:30,ry:25},screen:"232,611 316,615 316,684 232,682",label:[212,843],shortName:"Code Review"},
  "release-agent": {head:{cx:1429,cy:700,rx:31,ry:26},screen:"1379,617 1462,626 1462,692 1379,681",label:[1450,853],shortName:"Release"},
};
