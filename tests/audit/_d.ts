import fs from 'fs';
const B = JSON.parse(fs.readFileSync('tests/audit/before.json','utf8')).app, A = JSON.parse(fs.readFileSync('tests/audit/after.json','utf8')).app;
for (const ab of A.brigadeAccountings) {
  const bb = B.brigadeAccountings.find((x:any)=>x.brigadeId===ab.brigadeId);
  if (JSON.stringify(bb)===JSON.stringify(ab)) continue;
  console.log('brigade', ab.brigadeId, 'cash', bb?.cashReceived, '->', ab.cashReceived, 'due', bb?.totalDue, '->', ab.totalDue, 'rest', bb?.rest, '->', ab.rest, 'id', bb?.id, ab.id);
  console.log(' justifs before', bb?.justifications.map((j:any)=>[j.justificationType,j.amount,j.pompisteId]));
  console.log(' justifs after ', ab.justifications.map((j:any)=>[j.justificationType,j.amount,j.pompisteId,j.entryMode,(j.operations||[]).length]));
  const b1 = B.brigades.find((x:any)=>x.id===ab.brigadeId), b2 = A.brigades.find((x:any)=>x.id===ab.brigadeId);
  console.log(' pdata before', JSON.stringify(b1.pompisteData)); console.log(' pdata after ', JSON.stringify(b2.pompisteData));
  console.log(' vers before', JSON.stringify(b1.versements)); console.log(' vers after ', JSON.stringify(b2.versements));
}
console.log('accountings count', B.brigadeAccountings.length, A.brigadeAccountings.length);
const tx = (s:any)=>s.treasuryTransactions.filter((t:any)=>t.refType==='brigade');
console.log('brigade tx before', tx(B).map((t:any)=>[t.kind,t.amount,t.refId,t.accountTo])); console.log('after', tx(A).map((t:any)=>[t.kind,t.amount,t.refId,t.accountTo]));
