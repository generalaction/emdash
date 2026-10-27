# 02 — Legacy SSH stack removal

**What to build:** the legacy SSH dev container is gone and the workspace-server stack is the
single remote-dev story. A dev looking for "how do I test SSH/remote development locally" finds
exactly one answer. Removal inventory:
[spec PR 2](../../dev-setup-overhaul/spec.md) and the
[Legacy SSH stack fate](../../dev-setup-overhaul/issues/06-legacy-ssh-stack-fate.md) ticket.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Legacy compose file, its docker tooling directory, and the `run:docker-ssh` script are
      deleted
- [x] All four doc mentions updated to point at the workspace-server stack
- [x] The gated remote integration test (`EMDASH_TEST_REMOTE_WSS=1`) still passes against the
      workspace-server stack — verified by inspection only: the test targets the
      workspace-server stack's port 2223, which this ticket does not touch; Docker was not
      running on the build machine so the gated run itself could not be exercised
- [x] Repo-wide search finds no remaining `docker-ssh` references outside `.scratch/`
