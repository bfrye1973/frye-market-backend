// Shared Engine 10 Journal maintenance guard.
// A lock file on the persistent Journal disk blocks every Journal write path
// that uses tradeJournalStore. Reads continue normally.
// Operators must not use the lock until this code is deployed on ALL writers.
import fs from "node:fs";
import path from "node:path";

export const journalMaintenanceLockPath = journalDir =>
  path.join(path.resolve(journalDir),".engine10-journal-maintenance.lock");

export function assertJournalWritable(journalDir) {
  const lock=journalMaintenanceLockPath(journalDir);
  if(fs.existsSync(lock)){
    const error=new Error("ENGINE10_JOURNAL_MAINTENANCE_LOCKED");
    error.code="ENGINE10_JOURNAL_MAINTENANCE_LOCKED";
    throw error;
  }
}

export function journalMaintenanceStatus(journalDir){
 const lock=journalMaintenanceLockPath(journalDir);
 return {locked:fs.existsSync(lock),lockPath:lock};
}
