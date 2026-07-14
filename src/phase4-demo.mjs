import { buildPilotVerification, deploymentManifest } from './phase4/production.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const names=['audit','review','score','report','share','finding','intervention','implementationEvidence','rerun','evaluation'];
const result=buildPilotVerification({environment:'test',commitSha:'89ffed8340f272cbaeba8057733ddbd4e80ef833',stages:Object.fromEntries(names.map(name=>[name,{status:'passed',evidenceId:`fixture:${name}`}])) ,security:{crossWorkspaceDenied:true,expiredLinkDenied:true,revokedLinkDenied:true}});
const manifest=deploymentManifest({environment:'test',commitSha:'89ffed8340f272cbaeba8057733ddbd4e80ef833',schemaVersion:'202607140006',builtAt:'2026-07-14T00:00:00Z'});
await mkdir('output/phase4-demo',{recursive:true});
await writeFile('output/phase4-demo/pilot-verification.json',JSON.stringify({result,manifest},null,2));
console.log(JSON.stringify({status:result.status,stages:result.stages.length,liveInfrastructureVerified:result.liveInfrastructureVerified},null,2));
