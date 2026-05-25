---
title: "Kubernetes Backup and Restore Operations"
description: "A practitioner-oriented reference for Kubernetes backup and restore design, decision guidance, restore runbooks, failure scenarios, testing checklists, and maintenance cadence."
tags:
  - "research"
  - "devops"
  - "kubernetes"
  - "backup"
  - "disaster-recovery"
  - "velero"
  - "storage"
area: general
status: active
difficulty: intermediate
review_status: needs_review
generated_by: omg-wiki-research
human_reviewed: false
last_verified: 2026-05-25
confidence: medium
sources:
  - title: "csrc.nist.gov"
    url: "https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final"
    accessed: 2026-05-25
  - title: "kubernetes.io"
    url: "https://kubernetes.io/docs/concepts/storage/persistent-volumes/"
    accessed: 2026-05-25
  - title: "kubernetes.io"
    url: "https://kubernetes.io/docs/concepts/storage/storage-classes/"
    accessed: 2026-05-25
  - title: "kubernetes.io"
    url: "https://kubernetes.io/docs/concepts/storage/volume-snapshots/"
    accessed: 2026-05-25
  - title: "kubernetes.io"
    url: "https://kubernetes.io/docs/concepts/storage/volumes/"
    accessed: 2026-05-25
  - title: "kubernetes.io"
    url: "https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/"
    accessed: 2026-05-25
  - title: "kubernetes.io"
    url: "https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/"
    accessed: 2026-05-25
  - title: "etcd.io"
    url: "https://etcd.io/docs/v3.5/op-guide/recovery/"
    accessed: 2026-05-25
  - title: "velero.io"
    url: "https://velero.io/docs/v1.18/backup-reference/"
    accessed: 2026-05-25
  - title: "velero.io"
    url: "https://velero.io/docs/v1.18/restore-reference/"
    accessed: 2026-05-25
  - title: "velero.io"
    url: "https://velero.io/docs/v1.18/file-system-backup/"
    accessed: 2026-05-25
  - title: "velero.io"
    url: "https://velero.io/docs/v1.18/csi/"
    accessed: 2026-05-25
  - title: "velero.io"
    url: "https://velero.io/docs/v1.18/resource-filtering/"
    accessed: 2026-05-25
  - title: "velero.io"
    url: "https://velero.io/docs/v1.18/backup-hooks/"
    accessed: 2026-05-25
  - title: "velero.io"
    url: "https://velero.io/docs/v1.18/restore-hooks/"
    accessed: 2026-05-25
  - title: "velero.io"
    url: "https://velero.io/docs/v1.18/restore-resource-modifiers/"
    accessed: 2026-05-25
  - title: "velero.io"
    url: "https://velero.io/docs/v1.18/backup-repository-configuration/"
    accessed: 2026-05-25
  - title: "velero.io"
    url: "https://velero.io/docs/v1.18/repository-maintenance/"
    accessed: 2026-05-25
  - title: "velero.io"
    url: "https://velero.io/docs/v1.18/troubleshooting/"
    accessed: 2026-05-25
  - title: "www.postgresql.org"
    url: "https://www.postgresql.org/docs/current/continuous-archiving.html"
    accessed: 2026-05-25
  - title: "www.mongodb.com"
    url: "https://www.mongodb.com/docs/manual/core/backups/"
    accessed: 2026-05-25
  - title: "redis.io"
    url: "https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/"
    accessed: 2026-05-25
  - title: "docs.aws.amazon.com"
    url: "https://docs.aws.amazon.com/ebs/latest/userguide/ebs-snapshots.html"
    accessed: 2026-05-25
  - title: "docs.aws.amazon.com"
    url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html"
    accessed: 2026-05-25
---

# Kubernetes Backup and Restore Operations

## Summary

Kubernetes recovery is not one backup job; it is a layered system that has to cover control-plane state, API objects, persistent volumes, storage-provider snapshots, and application data semantics. PersistentVolumes are cluster resources with a lifecycle independent of any individual Pod, and etcd stores Kubernetes API objects, so recreating Pods or redeploying manifests does not automatically recover the state that a production workload depends on [2][7]. A useful recovery note should therefore separate what is recovered by etcd snapshots, what is recovered by Velero, what is recovered by a CSI driver, and what must be recovered by the application or database itself [8][9][20]. [1](https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final) [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)

The practical baseline is a documented RPO/RTO target for each service, a scheduled backup path, an isolated restore test path, and explicit ownership for the storage backend. NIST contingency-planning guidance treats recovery strategy and operational planning as part of a system lifecycle, and the same mindset fits Kubernetes: a backup design is not complete until the team can restore it, prove the recovered application is coherent, and repeat the process after upgrades or storage changes [1]. For write-heavy stateful services, volume snapshots can be a useful crash-consistency layer, but PostgreSQL-style point-in-time recovery still depends on archived WAL that reaches back to the base backup [20]. [1](https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final) [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)

- Assumption: this page targets Kubernetes clusters where Velero, CSI snapshot support, or both may be available, and where database engines may still need their own PITR or dump strategy [10][11][12][20]. [1](https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final) [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
- Operator goal: make the recovery path boring by rehearsing namespace restores, PV/PVC binding, storage-class mapping, and application health checks before an incident [10][19]. [1](https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final) [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)

## Decision Matrix

The core decision is not whether to use Velero or snapshots; it is which layer owns which recovery objective. Velero is a strong fit for Kubernetes API objects, namespace-scoped resources, and persistent volume restore workflows, while etcd snapshots protect the cluster control plane and database-native recovery protects transaction streams that Kubernetes does not understand [7][8][9][20]. StorageClass and CSI details must be included in the decision because a restored PVC is only useful if the destination cluster has compatible provisioning, topology, reclaim policy, and snapshot behavior [3][4][12]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [3](https://kubernetes.io/docs/concepts/storage/storage-classes/)

For RPO, use the workload write rate as the reality check. A nightly namespace backup may be fine for stateless services and low-change configuration, but a busy database needs either application-native log replay, a shorter snapshot cadence, or both. For RTO, include the slowest step in the path: downloading file-system-backup data, creating a new volume from a provider snapshot, replaying WAL or oplog data, waiting for StatefulSet readiness, and updating ingress or load balancer targets [6][10][11][20][21]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [3](https://kubernetes.io/docs/concepts/storage/storage-classes/)

- Manifest-only or GitOps redeploy: choose for stateless workloads and declarative configuration; do not count it as PV or database recovery [2][6]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [3](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- Velero resource backup: choose for namespaces, CRDs, RBAC, Secrets, ConfigMaps, Services, and workload objects; define filters deliberately because include and exclude flags change what is captured [9][13]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [3](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- CSI snapshot: choose for PVCs backed by a CSI driver with snapshot support and documented durability; verify VolumeSnapshotClass selection and driver-name compatibility before cross-cluster restores [4][12]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [3](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- Velero File System Backup: choose when snapshot support is missing or when data must be moved away from the storage platform; avoid presenting it as equivalent consistency to storage snapshots because it reads live mounted filesystems [11]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [3](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- etcd snapshot: choose for control-plane disaster recovery; verify snapshot status and keep the restore procedure separate from namespace/PVC restore jobs [7][8]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [3](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- Database-native PITR or dump: choose when the application needs transaction-aware recovery, such as PostgreSQL WAL replay, MongoDB method-specific tradeoffs, or Redis persistence-mode recovery [20][21][22]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [3](https://kubernetes.io/docs/concepts/storage/storage-classes/)

## Reference Architecture

A reference architecture should use four recovery lanes. The control-plane lane captures etcd snapshots and verifies them with etcdutl. The resource lane captures Kubernetes API objects with Velero, including CRDs and cluster-scoped dependencies when needed. The volume lane captures PVC data through CSI snapshots, cloud block snapshots, or File System Backup. The application-data lane captures transaction-aware artifacts such as WAL archives, database backups, MongoDB backup streams, or Redis persistence files, depending on the workload [7][8][9][11][12][20][21][22]. [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) [7](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)

The storage design should be provider-aware without becoming provider-dependent. Kubernetes VolumeSnapshot objects standardize snapshot requests, but the actual durability and portability depend on the CSI driver and storage provider [4][12]. AWS EBS snapshots are point-in-time, incremental backups and AWS says customers are responsible for regularly creating or automating them, which is a good reminder that a CSI-capable cluster still needs an explicit snapshot schedule and retention policy [23]. Backup object storage should be locked down and monitored; S3 Object Lock can provide WORM-style protection, but Velero also documents cases where object-store immutability can conflict with backup metadata updates or deletion behavior, so this needs a provider-and-version test rather than a checkbox [9][24]. [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) [7](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)

- Control-plane lane: scheduled etcd snapshots, encrypted snapshot storage, status verification, and a documented new-logical-cluster restore path [7][8]. [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) [7](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)
- Resource lane: Velero backups with explicit namespace, resource, and cluster-scope filters; resource policies for reusable skip/snapshot/fs-backup decisions [9][13]. [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) [7](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)
- Volume lane: prefer CSI snapshots where durability and restore compatibility are proven; use File System Backup when snapshot support is absent or storage independence is more important than snapshot-level consistency [11][12]. [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) [7](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)
- Application lane: database-native PITR or backup mechanisms for workloads whose correctness depends on transaction logs or engine-specific recovery [20][21][22]. [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) [7](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)

## Restore Runbook

A restore begins with containment and evidence, not with a blind command. Declare the incident scope, stop or fence writers when data corruption is suspected, identify the restore point, record the current cluster version and storage driver versions, and collect Velero debug material before changing the target environment. Velero supports a debug bundle that includes version information, server and plugin logs, Velero-managed resources, and backup or restore logs when specified, so it is a useful artifact for the incident record [19]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [6](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)

The safest restore target is an isolated namespace or recovery cluster first, then production after verification. A typical pre-change backup can use `velero backup create <backup-name> --include-namespaces <namespace> --wait`, while a namespace rehearsal can use `velero restore create <restore-name> --from-backup <backup-name> --namespace-mappings <old>:<new> --wait` and then `velero restore logs <restore-name>` for evidence [9][10][13]. For control-plane loss, use an etcd-specific path such as `ETCDCTL_API=3 etcdctl --endpoints $ENDPOINT snapshot save snapshot.db`, `etcdutl --write-out=table snapshot status snapshot.db`, and an etcdutl restore with revision bump and compacted marking when restoring Kubernetes from an older snapshot [7][8]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [6](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)

- Step 1: choose the restore point by matching business RPO, Velero backup timestamp, volume snapshot readiness, and database log availability [9][12][20]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [6](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)
- Step 2: restore API objects and PVCs into a non-production namespace or recovery cluster; use namespace mappings and storage-class mappings when the destination differs from the source [10]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [6](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)
- Step 3: verify PV/PVC binding, StatefulSet readiness, service endpoints, secrets, config, and application-level invariants before allowing traffic [2][6][10]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [6](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)
- Step 4: replay application-native data logs or restore database backups when the workload requires point-in-time correctness beyond the volume snapshot [20][21][22]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [6](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)
- Step 5: capture final evidence: restore logs, application checks, data-consistency checks, RPO achieved, RTO achieved, and any manual changes made during recovery [19]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [6](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)

## Failure Scenarios

Control-plane loss and workload loss are different incidents. If all control-plane nodes or etcd members are lost, Velero namespace backups do not replace the need for an etcd snapshot because the Kubernetes API state itself lives in etcd [7]. If only an application namespace is deleted, restoring the namespace and its dependent cluster-scoped resources may be enough, but the restore still has to account for PV/PVC behavior, custom resources, StorageClasses, and any database logs that live outside the Kubernetes backup [2][3][9][10][20]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [3](https://kubernetes.io/docs/concepts/storage/storage-classes/)

Storage failure modes deserve their own drills. A CSI snapshot can fail because the snapshot controller or driver is missing, the destination cluster uses a different CSI driver name, or the provider snapshot is not durable enough for the threat model [4][12]. File System Backup can recover volumes that lack native snapshots, but it reads live mounted filesystems and therefore may be weaker for hot database consistency unless paired with quiescing hooks or database-native backup [11][14][20]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [3](https://kubernetes.io/docs/concepts/storage/storage-classes/)

- Deleted namespace: restore to a temporary namespace first, inspect resources, then decide whether to restore in place or promote traffic to the recovered namespace [10][13]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [3](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- Corrupted database: stop writes, choose a pre-corruption base backup or volume snapshot, replay application logs only to the desired point, and keep the bad volume read-only for investigation [20][21]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [3](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- PVC binds to the wrong class: use Velero storage-class mapping or restore resource modifiers, and verify provisioner, topology, and reclaim policy before starting the application [3][10][16]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [3](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- LoadBalancer changes identity: expect restored Services to receive different cloud load balancer identifiers, and plan DNS or CNAME updates as part of cutover [19]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [3](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- Webhook or CRD dependency blocks restore: restore CRDs and controllers in the documented order and verify discoverability before restoring custom resources [10]. [2](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) [3](https://kubernetes.io/docs/concepts/storage/storage-classes/)

## Operational Checklist

Daily operations should prove that backups are being created, uploaded, and retained where the runbook expects them. Velero schedules use cron expressions, and scheduled backups are not taken until the next scheduled time unless an operator explicitly triggers one from the schedule [9]. A simple operating habit is to review the latest scheduled backup, inspect warnings, confirm expected namespaces and resource filters, and check whether any storage snapshots or file-system-backup uploads are still in progress before declaring the backup window successful [9][12][13]. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)

Weekly or monthly operations should prove that restores work. A rehearsal should restore a representative namespace into a mapped namespace, verify resource order and PVC binding, exercise restore hooks where needed, replay application data where required, and record RPO/RTO evidence. Repository maintenance and cache sizing also need attention: Velero runs repository maintenance as Kubernetes jobs, and backup repositories have configurable cache and full-maintenance settings that can affect performance and cleanup behavior [10][15][17][18]. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)

- Every backup window: verify the newest backup exists, status is complete, logs have no unexplained warnings, and expected volume backup method was used [9][11][19]. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- Every restore test: use namespace mapping, validate storage-class behavior, run application probes, and document achieved RPO/RTO [10][13]. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- Every storage change: repeat CSI snapshot and restore tests after CSI driver, StorageClass, VolumeSnapshotClass, topology, encryption key, or region changes [3][4][12][23]. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- Every database change: confirm WAL, oplog, dump, or persistence settings still match the service RPO and that application owners can perform replay or validation [20][21][22]. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- Every quarter: review object storage retention, object-lock behavior, credentials, repository maintenance jobs, restore hooks, and debug-bundle capture procedure [14][15][18][19][24]. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)

## Common Pitfalls

The most common mistake is treating a successful backup command as a successful recovery plan. A Velero backup can contain the expected Kubernetes objects while still being unusable for the business objective because the database logs are missing, the destination CSI driver is incompatible, a StorageClass maps to different performance or topology, or the restore has never been tested under production-like admission policies [3][10][12][20]. Another quiet failure is excluding cluster-scoped resources during a namespace-focused backup and then discovering that CRDs, StorageClasses, or RBAC dependencies are missing during restore [10][13]. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)

Another pitfall is assuming all volume backup paths have the same consistency model. CSI snapshots are point-in-time requests to a provider driver; File System Backup reads a mounted live filesystem and is documented as less consistent than snapshot approaches [4][11]. Backup hooks can reduce risk for filesystem-level snapshots by running commands before and after backup work, but hooks are not a substitute for database-native recovery when the engine requires WAL, oplog, or append-only replay to meet RPO [14][20][21][22]. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)

- Do not use `kubectl delete backup <name> -n <veleroNamespace>` when the goal is to remove backup data from object or block storage; Velero documents different deletion semantics for kubectl deletion versus `velero backup delete` [9]. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- Do not enable schedule owner references casually in GitOps-managed environments; Velero documents side effects where schedule deletion and backup CR synchronization can conflict [9]. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- Do not assume immutable object storage is automatically compatible with Velero; test the exact provider mode because Velero updates backup metadata during normal operation [9][24]. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- Do not assume restored LoadBalancer Services keep the same cloud load balancer identity; plan DNS and external dependency updates [19]. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- Do not rotate or relocate backup repository settings without testing old backup restores; repository configuration, cache, and maintenance behavior are part of the recovery path [17][18]. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)

## Maintenance Notes

Backup maintenance should be tied to the same change calendar as cluster upgrades, CSI driver upgrades, database major upgrades, and storage-class changes. When the storage class, CSI driver name, snapshot class, or database engine changes, the previous restore evidence expires for that workload because the binding, snapshot, or replay path may have changed [3][4][10][12][20]. A mature runbook records the cluster version, Velero version, plugin set, CSI driver, StorageClass, VolumeSnapshotClass, and database recovery method alongside every successful restore rehearsal. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)

Repository maintenance is operational work, not background magic. Velero decouples repository maintenance into Kubernetes jobs, provides resource and affinity configuration, and exposes recent maintenance history; that makes maintenance schedulable and observable, but it also means resource-starved clusters can starve backup maintenance if nobody owns it [18]. For large File System Backup repositories, tune cache and maintenance intervals carefully, because shorter full-maintenance intervals can remove unused data sooner but may weaken data safety if applied incorrectly [17]. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)

- Monthly: restore at least one representative namespace and one representative PVC path, then record RPO/RTO, commands used, backup IDs, snapshot IDs if available, and validation results [9][10][12]. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- After upgrades: retest Velero backup, Velero restore, CSI snapshot creation, CSI restore, File System Backup, and application-native database recovery [10][11][12][20]. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- After credential or retention changes: verify that Velero can still list, read, restore, and delete according to policy, and that object-lock settings do not block required metadata updates [9][19][24]. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- For auditability: keep debug bundles, restore logs, application validation output, and a short incident-style note for every successful and failed rehearsal [19]. [3](https://kubernetes.io/docs/concepts/storage/storage-classes/) [4](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)

## Sources

1. [csrc.nist.gov](https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final)
2. [kubernetes.io](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
3. [kubernetes.io](https://kubernetes.io/docs/concepts/storage/storage-classes/)
4. [kubernetes.io](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
5. [kubernetes.io](https://kubernetes.io/docs/concepts/storage/volumes/)
6. [kubernetes.io](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)
7. [kubernetes.io](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)
8. [etcd.io](https://etcd.io/docs/v3.5/op-guide/recovery/)
9. [velero.io](https://velero.io/docs/v1.18/backup-reference/)
10. [velero.io](https://velero.io/docs/v1.18/restore-reference/)
11. [velero.io](https://velero.io/docs/v1.18/file-system-backup/)
12. [velero.io](https://velero.io/docs/v1.18/csi/)
13. [velero.io](https://velero.io/docs/v1.18/resource-filtering/)
14. [velero.io](https://velero.io/docs/v1.18/backup-hooks/)
15. [velero.io](https://velero.io/docs/v1.18/restore-hooks/)
16. [velero.io](https://velero.io/docs/v1.18/restore-resource-modifiers/)
17. [velero.io](https://velero.io/docs/v1.18/backup-repository-configuration/)
18. [velero.io](https://velero.io/docs/v1.18/repository-maintenance/)
19. [velero.io](https://velero.io/docs/v1.18/troubleshooting/)
20. [www.postgresql.org](https://www.postgresql.org/docs/current/continuous-archiving.html)
21. [www.mongodb.com](https://www.mongodb.com/docs/manual/core/backups/)
22. [redis.io](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
23. [docs.aws.amazon.com](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-snapshots.html)
24. [docs.aws.amazon.com](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)
