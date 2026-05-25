---
title: "Kubernetes Backup and Restore Operations"
description: "Professional DevOps reference for Kubernetes backup architecture, restore decision-making, runbooks, storage-driver caveats, RPO/RTO examples, operational checks, and maintenance cadence."
tags:
  - "research"
  - "devops"
  - "kubernetes"
  - "backup"
  - "restore"
  - "disaster-recovery"
area: general
status: active
difficulty: intermediate
review_status: needs_review
generated_by: omg-wiki-research
human_reviewed: false
last_verified: 2026-05-25
confidence: medium
sources:
  - title: "kubernetes.io"
    url: "https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/"
    accessed: 2026-05-25
  - title: "etcd.io"
    url: "https://etcd.io/docs/v3.5/op-guide/recovery/"
    accessed: 2026-05-25
  - title: "kubernetes.io"
    url: "https://kubernetes.io/docs/concepts/storage/volume-snapshots/"
    accessed: 2026-05-25
  - title: "kubernetes.io"
    url: "https://kubernetes.io/docs/concepts/storage/storage-classes/"
    accessed: 2026-05-25
  - title: "kubernetes.io"
    url: "https://kubernetes.io/docs/concepts/storage/persistent-volumes/"
    accessed: 2026-05-25
  - title: "kubernetes.io"
    url: "https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/"
    accessed: 2026-05-25
  - title: "kubernetes.io"
    url: "https://kubernetes.io/docs/tasks/run-application/configure-pdb/"
    accessed: 2026-05-25
  - title: "kubernetes.io"
    url: "https://kubernetes.io/docs/concepts/workloads/pods/probes/"
    accessed: 2026-05-25
  - title: "kubernetes.io"
    url: "https://kubernetes.io/docs/concepts/workloads/controllers/deployment/"
    accessed: 2026-05-25
  - title: "kubernetes.io"
    url: "https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/"
    accessed: 2026-05-25
  - title: "velero.io"
    url: "https://velero.io/"
    accessed: 2026-05-25
  - title: "velero.io"
    url: "https://velero.io/docs/v1.18/backup-reference/"
    accessed: 2026-05-25
  - title: "velero.io"
    url: "https://velero.io/docs/v1.18/restore-reference/"
    accessed: 2026-05-25
  - title: "velero.io"
    url: "https://velero.io/docs/v1.18/csi/"
    accessed: 2026-05-25
  - title: "velero.io"
    url: "https://velero.io/docs/v1.18/disaster-case/"
    accessed: 2026-05-25
  - title: "velero.io"
    url: "https://velero.io/docs/v1.18/troubleshooting/"
    accessed: 2026-05-25
  - title: "argo-cd.readthedocs.io"
    url: "https://argo-cd.readthedocs.io/en/latest/operator-manual/disaster_recovery/"
    accessed: 2026-05-25
  - title: "opengitops.dev"
    url: "https://opengitops.dev/"
    accessed: 2026-05-25
  - title: "prometheus.io"
    url: "https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/"
    accessed: 2026-05-25
  - title: "prometheus.io"
    url: "https://prometheus.io/docs/alerting/latest/alertmanager/"
    accessed: 2026-05-25
  - title: "opentelemetry.io"
    url: "https://opentelemetry.io/docs/platforms/kubernetes/getting-started/"
    accessed: 2026-05-25
  - title: "opentelemetry.io"
    url: "https://opentelemetry.io/docs/platforms/kubernetes/collector/components/"
    accessed: 2026-05-25
  - title: "nvlpubs.nist.gov"
    url: "https://nvlpubs.nist.gov/nistpubs/legacy/sp/nistspecialpublication800-34r1.pdf"
    accessed: 2026-05-25
  - title: "sre.google"
    url: "https://sre.google/sre-book/emergency-response/"
    accessed: 2026-05-25
  - title: "docs.cloud.google.com"
    url: "https://docs.cloud.google.com/architecture/dr-scenarios-planning-guide"
    accessed: 2026-05-25
  - title: "kubernetes.io"
    url: "https://kubernetes.io/docs/concepts/policy/resource-quotas/"
    accessed: 2026-05-25
  - title: "kubernetes.io"
    url: "https://kubernetes.io/docs/concepts/policy/limit-range/"
    accessed: 2026-05-25
---

# Kubernetes Backup and Restore Operations

## Summary

This page treats Kubernetes recovery as a three-layer problem: control-plane state, declared desired state, and runtime/application data. Kubernetes stores API objects in etcd, so etcd snapshots are the emergency path for a lost control plane, while GitOps repositories and Velero backups cover the declarative and cluster-resource layers [1][2][11][18]. PersistentVolume data needs separate treatment because etcd stores Kubernetes object metadata, not an application-consistent copy of every backing disk or database file [4][5]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

The operating assumptions are an etcd-backed Kubernetes cluster, workloads split between stateless Deployments and PersistentVolume-backed StatefulSets, a separate object store or backup target, and operators who can perform an isolated restore drill without touching production. RTO and RPO should be written as measurable service objectives rather than informal labels: for example, a platform tier may accept a 60-minute RPO and four-hour RTO for internal tools, while a customer-facing data service may need a 15-minute RPO and one-hour RTO only after the storage, database, and staffing model can prove it under test [23][25]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

The safest recovery plan is deliberately boring. It records what is backed up, where it is stored, which identity can read it, how often restore tests run, and which checks make the restore complete. A backup that cannot be selected, decrypted, restored, and verified by someone other than its author is an aspiration, not an operational control [15][23]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

- Protect the layers separately: etcd snapshot for cluster object state, GitOps for declared desired state, Velero for Kubernetes resources, CSI or file-system backup for volume data, and app-native backup for databases with consistency requirements [1][11][14][18]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- Do not call a restore complete when the objects are visible; complete it only after readiness checks pass, service smoke tests succeed, telemetry is present, and the service owner accepts the chosen recovery point [8][19][20]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- Write explicit assumptions next to every RPO/RTO target: backup frequency, snapshot durability, restore location, object-store availability, credentials, operator access, and validation commands [23][25]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

## Decision Matrix

No single Kubernetes backup mechanism is the correct answer for every incident. etcd restore is powerful but blunt: it is appropriate for control-plane loss or catastrophic object-store corruption, not for casually reverting one namespace after a bad deployment. Velero restore is better for resource-level recovery and migration, but persistent data recovery depends on the volume protection mode and the storage driver underneath [1][2][12][13]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

The decision point is the smallest safe blast radius that restores the service objective. A deleted ConfigMap, failed rollout, or accidental namespace removal should normally be handled through GitOps reconciliation or a scoped Velero restore. A corrupted control plane with no trustworthy API state may require etcd snapshot restore. A corrupted database volume should usually prefer the database's own backup and consistency workflow unless the CSI snapshot process is known to produce a durable, application-consistent recovery point [2][13][14][18]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

- Control plane destroyed or etcd data directory lost: restore every etcd member from the same verified snapshot, create a new logical cluster, and use revision bump plus compaction when restoring an older snapshot into Kubernetes controller environments [1][2]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- Namespace or application resource accidentally deleted: restore from a Velero backup or let the GitOps controller reconcile from versioned desired state; prefer the narrower path that avoids overwriting unrelated live resources [12][13][18]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- PersistentVolume quick restore in the same environment: use CSI snapshots only after confirming the VolumeSnapshot CRDs, snapshot controller, snapshot class, and CSI driver capabilities are installed and tested [3][14]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- Cross-cluster or cross-provider restore: prefer Velero file-system backup or application-native backup when CSI snapshot portability or durability is not guaranteed by the driver and storage backend [13][14]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- GitOps-controller loss: rebuild application manifests from Git, and restore controller state with the product's supported export/import flow when that state is not fully represented in repositories [17][18]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- Pre-maintenance safety point: run `velero backup create --from-schedule <schedule-name>` and record the resulting backup name before risky upgrades; record an etcd snapshot status table for control-plane work [1][12]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

## Reference Architecture

A reliable Kubernetes recovery architecture keeps the write paths independent. The Git repository is the versioned source for declarative desired state, the etcd snapshot store holds encrypted control-plane recovery points, the Velero backup storage location holds resource backups and related metadata, and the volume layer holds either CSI snapshots, file-system backups, or application-native backups depending on workload requirements [1][11][14][18]. These stores should not share one untested credential path, one unmonitored lifecycle policy, or one undocumented retention rule. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

The restore lane should be as real as production without being production. Maintain a small isolated cluster or namespace pattern where a selected backup can be restored, probes can run, and smoke tests can verify ingress, DNS, secrets, storage binding, and application behavior. The telemetry lane should survive or be quickly rebuilt after restore: Prometheus alerting rules, Alertmanager routing, and OpenTelemetry collection need enough context to distinguish a successful recovery from a quiet monitoring failure [19][20][21][22]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

Storage deserves a dedicated design review. StorageClasses define provisioners, parameters, reclaim policy, and binding mode, while PersistentVolumes have a lifecycle separate from Pods and PersistentVolumeClaims. That means restored manifests can look correct while volumes fail to bind, bind in the wrong topology, or inherit a reclaim policy that is dangerous during cleanup [4][5]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

- Reference flow: Git repository -> GitOps controller -> Kubernetes API -> etcd; Velero schedule -> backup storage location; CSI snapshot or file-system backup -> volume data store; alerting and telemetry -> independent incident channel [11][18][20][21]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- Keep backup credentials separate from routine deploy credentials where practical, and audit who can delete snapshots, object-store backups, and backup schedules [15][23]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- Make storage-driver caveats explicit: snapshot support, crash consistency, application consistency, topology constraints, cross-region availability, deletion behavior, and whether snapshots remain durable after source volume deletion [3][14]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- Use StorageClass names and snapshot class names deliberately; a restored claim that points at a missing or incompatible class is a restore failure, not a Kubernetes mystery [3][4][5]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

## Restore Runbook

A restore begins by freezing the blast radius. Pause deployment automation, stop planned node drains, identify whether writes must be stopped at the application layer, and choose the recovery path before running destructive commands. The recovery lead should record the incident start time, selected RPO target, chosen backup name or snapshot file, namespaces in scope, storage classes in scope, and the validation owner for each service [13][15][25]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

Control-plane restore and application restore should not be mixed casually. etcd restore reconstructs cluster state from a snapshot and can require every member to be rebuilt from the same point, with revision handling for Kubernetes controllers. Velero restore replays backed-up Kubernetes objects and persistent-volume data according to restore order, namespace mapping, resource policies, and the chosen volume restore mechanism [1][2][13]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

The runbook should end with proof, not optimism. A completed restore includes successful resource creation, bound volumes, healthy probes, service endpoints, application smoke tests, known data recovery point, and restored monitoring. If any admission webhook, quota, LoadBalancer, or storage binding issue blocks the process, capture logs and events before retrying so the next drill improves the runbook [8][15][26][27]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

- Select recovery point: `kubectl -n velero get backups`; `velero backup describe <backup-name>`; `velero backup logs <backup-name>`; `etcdutl --write-out=table snapshot status snapshot.db` [1][12][13]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- Control-plane template: `ETCDCTL_API=3 etcdctl --endpoints "$ENDPOINT" snapshot save snapshot.db`; restore with `etcdutl snapshot restore snapshot.db --data-dir <member-data-dir>` and apply revision bump and compaction options for older Kubernetes snapshots when required [1][2]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- Velero disaster template: set the BackupStorageLocation to read-only before restoring, run `velero restore create --from-backup <backup-name>`, watch restore status and logs, then return the location to read-write after validation [13][15]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- Namespace mapping template: `velero restore create --from-backup <backup-name> --namespace-mappings old-ns:new-ns` when testing a restore without overwriting the original namespace [13]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- GitOps controller template: after base infrastructure is healthy, restore Argo CD state with the supported `argocd admin export` and `argocd admin import` flow when controller state must be preserved beyond application manifests [17][18]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- Validation gate: check Pods, PVCs, Events, Services, ingress, readiness probes, synthetic transactions, alert state, and application data integrity before handing the service back [8][15][19][20]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

## Failure Scenarios

The most expensive restore failures are usually not command syntax errors; they are mismatched assumptions. A snapshot may exist but be tied to an unavailable storage backend, a restored object may be rejected by a namespace policy, an admission webhook may block its own dependency from returning, or a LoadBalancer service may not recreate the same external identity. Treat every restore drill as a search for these hidden assumptions [13][15][26][27]. [2](https://etcd.io/docs/v3.5/op-guide/recovery/) [3](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)

Stateful workloads introduce extra failure shapes. StatefulSets preserve identity and storage relationships, but deleting or scaling a StatefulSet does not automatically remove the associated volumes. That is good for data safety and dangerous for cleanup: stale claims and retained volumes can cause later restores to bind to the wrong data or fail because names are already taken [5][6]. [2](https://etcd.io/docs/v3.5/op-guide/recovery/) [3](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)

- etcd quorum loss: stop further writes, preserve current data directories for forensics, restore all members from the same verified snapshot, and use new member data directories rather than mixing old and restored state [1][2]. [2](https://etcd.io/docs/v3.5/op-guide/recovery/) [3](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- CSI snapshot not usable: confirm the VolumeSnapshot CRDs, snapshot controller, snapshot class, and driver support before assuming the snapshot is restorable or durable outside its original backend [3][14]. [2](https://etcd.io/docs/v3.5/op-guide/recovery/) [3](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- Interrupted Velero backup: an InProgress backup that was interrupted should not be assumed resumable; create a fresh backup and inspect the diagnostic bundle and logs [15][16]. [2](https://etcd.io/docs/v3.5/op-guide/recovery/) [3](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- Admission webhook blocks restore: temporarily disable or carefully sequence the webhook only when the restore target depends on resources the webhook prevents from being recreated; capture events first [16]. [2](https://etcd.io/docs/v3.5/op-guide/recovery/) [3](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- LoadBalancer identity changes: expect provider-specific service identifiers and DNS names to change after restore unless the provider and manifest explicitly preserve them; validate downstream DNS and allow lists [16]. [2](https://etcd.io/docs/v3.5/op-guide/recovery/) [3](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- PDB prevents maintenance: a zero voluntary-disruption budget can stop node drains; decide whether to change the budget, add replicas, or postpone maintenance rather than forcing disruption blindly [7]. [2](https://etcd.io/docs/v3.5/op-guide/recovery/) [3](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- Backup verification CronJob overlaps: set `concurrencyPolicy` and `startingDeadlineSeconds` intentionally so delayed jobs do not stack up or silently skip after controller downtime [10]. [2](https://etcd.io/docs/v3.5/op-guide/recovery/) [3](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- Quota or LimitRange rejection: inspect namespace ResourceQuota, LimitRange, Pod events, and restored requests/limits before blaming the scheduler or storage layer [26][27]. [2](https://etcd.io/docs/v3.5/op-guide/recovery/) [3](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)

## Operational Checklist

The checklist exists to keep recovery boring when people are tired. Daily checks should prove that scheduled backups completed and that alerts would fire when they do not. Weekly checks should sample restore metadata and storage-driver assumptions. Monthly checks should perform an isolated restore of at least one stateless workload and one stateful workload. Quarterly checks should rehearse a full control-plane or cluster-level scenario that exercises credentials, DNS, ingress, secrets, and monitoring [11][12][15][19][20]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

The cadence should map to service tiers. A low-criticality internal service can tolerate slower verification if its RTO/RPO is explicit. A regulated or revenue-critical service needs tighter backup frequency, shorter evidence loops, and documented restoration sampling. NIST's contingency guidance connects backup frequency, alternate processing, confidentiality, integrity, and restoration sampling to recovery objectives; that is the right mental model for platform operations too [23][25]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

- Daily: verify Velero schedule status, last backup completion time, failed backup alerts, object-store reachability, and control-plane snapshot job completion [11][12][15]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- Weekly: run `velero backup describe <recent-backup>` and inspect warnings, included namespaces, excluded resources, snapshot behavior, and retention policy [12][13]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- Monthly: restore one representative application into an isolated namespace using namespace mappings, verify PVC binding, probes, ingress, and application data checks [8][13]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- Quarterly: perform a control-plane restore drill from an etcd snapshot into a disposable environment and verify revision handling, controller behavior, and GitOps reconciliation [1][2][18]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- Before upgrades: create an on-demand backup from the normal schedule, capture an etcd snapshot status table, pause high-risk automation, and confirm rollback owners [1][12]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- Telemetry: alert when backups are absent past the RPO window, when restore drills fail, when object-store credentials expire, and when collector or Alertmanager outages would hide recovery signals [19][20][21][22]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

## Common Pitfalls

The most common pitfall is confusing a successful backup job with a recoverable system. A backup can finish while excluding the namespace that matters, skipping persistent data, storing snapshots in a backend that cannot be reached from the recovery cluster, or capturing resources that later fail admission because quotas and defaults changed. Good operators inspect restore behavior, not just backup status [12][13][15][26][27]. [3](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) [4](https://kubernetes.io/docs/concepts/storage/storage-classes/)

Another common mistake is treating Kubernetes abstractions as application consistency guarantees. A VolumeSnapshot or file-system backup may preserve blocks, but a database may still need its own flush, lock, checkpoint, or native backup process. StatefulSet identity helps workloads come back with stable names and storage relationships, but it does not decide whether the bytes are internally consistent [3][5][6][14]. [3](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) [4](https://kubernetes.io/docs/concepts/storage/storage-classes/)

- Do not rely on default StorageClass and reclaimPolicy behavior without documenting it; a Delete reclaim policy can be correct for ephemeral workloads and catastrophic for misunderstood restore cleanup [4][5]. [3](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) [4](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- Do not assume CSI snapshots are portable or durable across clusters, regions, or providers unless the CSI driver and storage backend explicitly support that tested path [3][14]. [3](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) [4](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- Do not let PDBs, rollout settings, or readiness probes drift out of sync with recovery assumptions; they shape maintenance safety and post-restore traffic routing [7][8][9]. [3](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) [4](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- Do not restore blindly over live namespaces; use namespace mappings or isolated clusters for drills and understand existing-resource policy before touching production [13]. [3](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) [4](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- Do not ignore Velero warnings about webhooks, LoadBalancer services, stuck backups, or missing credentials; those warnings often represent the exact issues that surface during an outage [15][16]. [3](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) [4](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- Do not let backup CronJobs overlap silently; choose `Allow`, `Forbid`, or `Replace` based on what should happen when a previous verification job is still running [10]. [3](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) [4](https://kubernetes.io/docs/concepts/storage/storage-classes/)

## Maintenance Notes

Backup documentation should have an owner, a review date, and evidence links to the last successful restore. Keep the runbook close to the commands, but keep sensitive values out of the wiki: endpoint names, credentials, encryption keys, and object-store secrets belong in approved secret-management systems, not in Markdown. The wiki should hold templates, assumptions, decision rules, and validation criteria [15][23]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

Review the page whenever Kubernetes, etcd, Velero, CSI drivers, cloud storage classes, ingress controllers, GitOps controllers, or monitoring stacks change. Recovery tooling is tightly coupled to versions and providers: a minor change to snapshot APIs, storage class defaults, or admission control can invalidate an otherwise polished runbook [2][3][4][13][14]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

Keep disaster exercises intentionally uncomfortable. A useful drill breaks a dependency, forces a human to select a recovery point, validates data quality, and records follow-up work. The goal is not to prove the team is perfect; it is to reveal the next weak link before a real incident [24][25]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

- Evidence to retain: backup name, snapshot identifier, object-store location, selected recovery point, restore duration, data validation result, alerts observed, and follow-up issues [12][13][19]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- Suggested maintenance cadence: daily backup health checks, monthly namespace restore, quarterly stateful restore, semiannual control-plane restore, and annual RTO/RPO review with service owners [1][2][23][25]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- RPO example: a daily Velero backup may be acceptable for generated development workloads, but it is not acceptable for a service whose owners promised 15 minutes of maximum data loss [12][25]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- RTO example: a four-hour RTO must include the time to obtain credentials, build or access the target cluster, restore resources, validate data, update DNS or traffic routing, and communicate service status [23][25]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)
- Version note: verify the active Kubernetes, etcd, Velero, CSI driver, and Argo CD documentation before changing commands in the live wiki; do not copy old syntax forward without a drill [1][2][13][17]. [1](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) [2](https://etcd.io/docs/v3.5/op-guide/recovery/)

## Sources

1. [kubernetes.io](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)
2. [etcd.io](https://etcd.io/docs/v3.5/op-guide/recovery/)
3. [kubernetes.io](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
4. [kubernetes.io](https://kubernetes.io/docs/concepts/storage/storage-classes/)
5. [kubernetes.io](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
6. [kubernetes.io](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)
7. [kubernetes.io](https://kubernetes.io/docs/tasks/run-application/configure-pdb/)
8. [kubernetes.io](https://kubernetes.io/docs/concepts/workloads/pods/probes/)
9. [kubernetes.io](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
10. [kubernetes.io](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)
11. [velero.io](https://velero.io/)
12. [velero.io](https://velero.io/docs/v1.18/backup-reference/)
13. [velero.io](https://velero.io/docs/v1.18/restore-reference/)
14. [velero.io](https://velero.io/docs/v1.18/csi/)
15. [velero.io](https://velero.io/docs/v1.18/disaster-case/)
16. [velero.io](https://velero.io/docs/v1.18/troubleshooting/)
17. [argo-cd.readthedocs.io](https://argo-cd.readthedocs.io/en/latest/operator-manual/disaster_recovery/)
18. [opengitops.dev](https://opengitops.dev/)
19. [prometheus.io](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
20. [prometheus.io](https://prometheus.io/docs/alerting/latest/alertmanager/)
21. [opentelemetry.io](https://opentelemetry.io/docs/platforms/kubernetes/getting-started/)
22. [opentelemetry.io](https://opentelemetry.io/docs/platforms/kubernetes/collector/components/)
23. [nvlpubs.nist.gov](https://nvlpubs.nist.gov/nistpubs/legacy/sp/nistspecialpublication800-34r1.pdf)
24. [sre.google](https://sre.google/sre-book/emergency-response/)
25. [docs.cloud.google.com](https://docs.cloud.google.com/architecture/dr-scenarios-planning-guide)
26. [kubernetes.io](https://kubernetes.io/docs/concepts/policy/resource-quotas/)
27. [kubernetes.io](https://kubernetes.io/docs/concepts/policy/limit-range/)
