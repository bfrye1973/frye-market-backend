import { captureCalendarDocument,buildCalendarRegistry,chicagoLabel } from '../../../logic/engine11/calendarEvidenceV1/registry.js';
import { captureReceipt } from '../../../logic/engine11/sourceObservationsV2/evidence.js';
import { buildSourceDataset } from '../../../logic/engine11/sourceObservationsV2/dataset.js';
export const observedAt='2026-10-13T00:00:00.000Z',asOf='2026-10-13T01:00:00.000Z';
export const doc=captureCalendarDocument({url:'https://www.cmegroup.com/research-fixture',body:Buffer.from('FIXTURE_NOT_EXCHANGE_SCHEDULE'),observedAt,evidenceKind:'FIXTURE',review:{state:'RESEARCH_REVIEWED',reviewer:'fixture-only',section:'fixture',reviewedAt:observedAt,coverageType:'FIXTURE',effectiveFrom:'2020-03-01',effectiveThrough:'2026-10-13'}});
export function session(overrides={}) {
 const openUtc='2026-09-09T22:00:00.000Z',closeUtc='2026-09-10T21:00:00.000Z';
 return {tradingDate:'2026-09-10',validationState:'COMPLETE_RESEARCH_SESSION_PROOF',documentIds:[doc.documentId],openUtc,closeUtc,openChicago:chicagoLabel(openUtc),closeChicago:chicagoLabel(closeUtc),segments:[{from:openUtc,to:closeUtc,state:'OPEN',reason:'FIXTURE_ORDINARY_SESSION'}],...overrides};
}
export const registry=sessions=>buildCalendarRegistry({documents:[doc],sessions:sessions??[session()]});
export function sourceDataset({ticker='ESU6',contract='ESU2026',timestamp='1789045200000000000',date='2026-09-10',binding=true}={}) {
 const receipt=captureReceipt({request:`https://api.massive.com/futures/v1/aggs/${ticker}?resolution=5min`,body:Buffer.from(JSON.stringify({status:'OK',results:[{ticker,window_start:timestamp,session_end_date:date,open:7600,high:7601,low:7599,close:7600,volume:1}]})),captureId:'fixture-source-'+ticker,observedAt,evidenceKind:'FIXTURE'});
 const metadata=captureReceipt({request:`https://api.massive.com/futures/v1/contracts?ticker=${ticker}&date=2026-09-10`,body:Buffer.from(JSON.stringify({status:'OK',results:[{ticker,product_code:'ES',trading_venue:'XCME',settlement_date:contract.startsWith('ESU')?'2026-09-18':'2026-12-18',first_trade_date:'2023-01-01',last_trade_date:contract.startsWith('ESU')?'2026-09-18':'2026-12-18'}]})),captureId:'fixture-meta-'+ticker,observedAt,evidenceKind:'FIXTURE'});
 return buildSourceDataset({receipts:binding?[metadata,receipt]:[receipt],bindings:binding?[{contract,ticker,metadataReceipt:metadata}]:[]});
}
