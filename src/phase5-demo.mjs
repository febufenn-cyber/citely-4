import { applyBillingEvent, checkEntitlement, claimSchedule, commercialMetrics, portfolioFixture } from './phase5/commercial.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const portfolio=portfolioFixture();
const billing=applyBillingEvent(null,{id:'fixture-event',type:'subscription.active',occurredAt:'2026-07-14T00:00:00Z',planKey:'agency-pro'}).projection;
const entitlement=checkEntitlement({plan:{status:'active',brandLimit:5,monthlyObservationLimit:1000,monthlyRunLimit:10,features:['csv','agency_branding']},usage:{brands:3,observations:120,runs:2},action:'observation',requested:100});
const schedule=claimSchedule({id:'monthly-client-a',status:'active',auditConfigurationId:'config-a'},'2026-08-01T03:00:00Z');
const metrics=commercialMetrics({validObservations:120,providerCostMicros:1800000,reviewMinutes:45,reportsDelivered:2,planRevenueMicros:10000000,brands:3,rerunsApproved:2,invitedWorkspaces:2,activatedWorkspaces:2});
await mkdir('output/phase5-demo',{recursive:true});await writeFile('output/phase5-demo/agency-commercial.json',JSON.stringify({portfolio,billing,entitlement,schedule,metrics},null,2));
console.log(JSON.stringify({clients:portfolio.clients.length,brands:portfolio.clients.flatMap(c=>c.brands).length,billing:billing.status,scheduleClaimed:schedule.claimed,marginWarning:metrics.marginWarning},null,2));
