// Non-deployable activation guard for proposed private Render recorder worker.
// Replaced only by a separately reviewed live transport in a future authorized PR.
// Even setting a flag cannot activate real licensed recording in Phase 4.
process.stderr.write('ENGINE18_RECORDER_LIVE_CAPTURE_NOT_IMPLEMENTED_OR_AUTHORIZED\n');
process.exitCode=78;
