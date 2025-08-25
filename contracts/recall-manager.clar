;; RecallManager.clar
;; Core contract for managing product recalls in the automated recall platform.

(define-trait batch-registry-trait
  (
    (get-batch-details (buff 32)) (response { owner: principal, metadata: (string-utf8 256), created-at: uint } uint)
    (is-batch-registered (buff 32)) (response bool uint)
  )
)

(define-trait contamination-reporter-trait
  (
    (get-report-details (uint)) (response { batch-hash: (buff 32), evidence: (buff 512), reporter: principal, timestamp: uint, verified: bool } uint)
    (get-report-count-for-batch (buff 32)) (response uint uint)
  )
)

(define-trait notification-hub-trait
  (
    (send-alert (principal (string-utf8 256) (buff 32) uint)) (response bool uint)
  )
)

(define-trait incentive-pool-trait
  (
    (reward-reporter (principal uint)) (response bool uint)
  )
)

(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-INVALID-BATCH u101)
(define-constant ERR-ALREADY-RECALLED u102)
(define-constant ERR-INSUFFICIENT-REPORTS u103)
(define-constant ERR-INVALID-STATUS u104)
(define-constant ERR-DISPUTE-EXISTS u105)
(define-constant ERR-NO-DISPUTE u106)
(define-constant ERR-PAUSED u107)
(define-constant ERR-INVALID-THRESHOLD u108)
(define-constant ERR-METADATA-TOO-LONG u109)
(define-constant ERR-INVALID-DURATION u110)
(define-constant MIN-REPORT-THRESHOLD u3)
(define-constant MAX_METADATA_LEN u512)
(define-constant MAX_DISPUTE_NOTES_LEN u256)
(define-constant DEFAULT_RECALL_DURATION u1440)

(define-data-var contract-owner principal tx-sender)
(define-data-var paused bool false)
(define-data-var auto-recall-threshold uint MIN-REPORT-THRESHOLD)
(define-data-var recall-counter uint u0)

(define-map recalls
  { recall-id: uint }
  {
    batch-hash: (buff 32),
    initiator: principal,
    timestamp: uint,
    status: (string-ascii 20),
    reason: (string-utf8 256),
    affected-count: uint,
    resolution-notes: (optional (string-utf8 512)),
    expiry-block: uint
  }
)

(define-map batch-recall-status
  { batch-hash: (buff 32) }
  {
    active-recall: bool,
    recall-id: (optional uint),
    last-updated: uint
  }
)

(define-map disputes
  { recall-id: uint }
  {
    disputer: principal,
    notes: (string-utf8 256),
    timestamp: uint,
    resolved: bool,
    resolution: (optional (string-utf8 256))
  }
)

(define-map recall-verifiers
  { recall-id: uint, verifier: principal }
  {
    vote: bool,
    timestamp: uint
  }
)

(define-map recall-metadata
  { recall-id: uint }
  {
    additional-data: (buff 512),
    linked-reports: (list 10 uint)
  }
)

(define-private (is-owner (caller principal))
  (is-eq caller (var-get contract-owner))
)

(define-private (is-paused)
  (var-get paused)
)

(define-private (increment-recall-counter)
  (let ((current (var-get recall-counter)))
    (var-set recall-counter (+ current u1))
    (+ current u1)
  )
)

(define-private (validate-batch (batch-hash (buff 32)) (batch-registry <batch-registry-trait>))
  (match (contract-call? batch-registry is-batch-registered batch-hash)
    success success
    error (err ERR-INVALID-BATCH)
  )
)

(define-private (check-report-threshold (batch-hash (buff 32)) (reporter <contamination-reporter-trait>))
  (let ((count (unwrap! (contract-call? reporter get-report-count-for-batch batch-hash) (err u500))))
    (>= count (var-get auto-recall-threshold))
  )
)

(define-public (initiate-recall 
  (batch-hash (buff 32)) 
  (reason (string-utf8 256))
  (linked-reports (list 10 uint))
  (additional-data (buff 512))
  (batch-registry <batch-registry-trait>)
  (reporter <contamination-reporter-trait>)
  (notification-hub <notification-hub-trait>)
  (incentive-pool <incentive-pool-trait>))
  (begin
    (asserts! (not (is-paused)) (err ERR-PAUSED))
    (asserts! (validate-batch batch-hash batch-registry) (err ERR-INVALID-BATCH))
    (let ((batch-status (map-get? batch-recall-status { batch-hash: batch-hash })))
      (asserts! (or (is-none batch-status) (not (get active-recall (unwrap-panic batch-status)))) (err ERR-ALREADY-RECALLED))
    )
    (asserts! (check-report-threshold batch-hash reporter) (err ERR-INSUFFICIENT-REPORTS))
    (asserts! (<= (len additional-data) MAX_METADATA_LEN) (err ERR-METADATA-TOO-LONG))
    (let ((recall-id (increment-recall-counter)))
      (map-set recalls
        { recall-id: recall-id }
        {
          batch-hash: batch-hash,
          initiator: tx-sender,
          timestamp: block-height,
          status: "initiated",
          reason: reason,
          affected-count: u0,
          resolution-notes: none,
          expiry-block: (+ block-height DEFAULT_RECALL_DURATION)
        }
      )
      (map-set batch-recall-status
        { batch-hash: batch-hash }
        {
          active-recall: true,
          recall-id: (some recall-id),
          last-updated: block-height
        }
      )
      (map-set recall-metadata
        { recall-id: recall-id }
        {
          additional-data: additional-data,
          linked-reports: linked-reports
        }
      )
      (try! (contract-call? notification-hub send-alert tx-sender "Recall Initiated" batch-hash recall-id))
      (try! (contract-call? incentive-pool reward-reporter tx-sender u100))
      (ok recall-id)
    )
  )
)

(define-public (verify-recall (recall-id uint) (vote bool))
  (let ((recall (map-get? recalls { recall-id: recall-id })))
    (asserts! (is-some recall) (err ERR-INVALID-BATCH))
    (asserts! (is-eq (get status (unwrap-panic recall)) "initiated") (err ERR-INVALID-STATUS))
    (asserts! (is-none (map-get? recall-verifiers { recall-id: recall-id, verifier: tx-sender })) (err ERR-ALREADY-RECALLED))
    (map-set recall-verifiers
      { recall-id: recall-id, verifier: tx-sender }
      {
        vote: vote,
        timestamp: block-height
      }
    )
    (ok true)
  )
)

(define-public (dispute-recall (recall-id uint) (notes (string-utf8 256)))
  (let ((recall (map-get? recalls { recall-id: recall-id })))
    (asserts! (is-some recall) (err ERR-INVALID-BATCH))
    (asserts! (is-eq (get status (unwrap-panic recall)) "initiated") (err ERR-INVALID-STATUS))
    (asserts! (is-none (map-get? disputes { recall-id: recall-id })) (err ERR-DISPUTE-EXISTS))
    (asserts! (<= (len notes) MAX_DISPUTE_NOTES_LEN) (err ERR-METADATA-TOO-LONG))
    (map-set disputes
      { recall-id: recall-id }
      {
        disputer: tx-sender,
        notes: notes,
        timestamp: block-height,
        resolved: false,
        resolution: none
      }
    )
    (map-set recalls
      { recall-id: recall-id }
      (merge (unwrap-panic recall) { status: "disputed" })
    )
    (ok true)
  )
)

(define-public (resolve-dispute (recall-id uint) (resolution (string-utf8 256)) (new-status (string-ascii 20)))
  (let ((dispute (map-get? disputes { recall-id: recall-id }))
        (recall (map-get? recalls { recall-id: recall-id })))
    (asserts! (is-some dispute) (err ERR-NO-DISPUTE))
    (asserts! (is-some recall) (err ERR-INVALID-BATCH))
    (asserts! (is-owner tx-sender) (err ERR-UNAUTHORIZED))
    (asserts! (not (get resolved (unwrap-panic dispute))) (err ERR-ALREADY-RECALLED))
    (asserts! (or (is-eq new-status "verified") (is-eq new-status "resolved")) (err ERR-INVALID-STATUS))
    (map-set disputes
      { recall-id: recall-id }
      (merge (unwrap-panic dispute) { resolved: true, resolution: (some resolution) })
    )
    (map-set recalls
      { recall-id: recall-id }
      (merge (unwrap-panic recall) { status: new-status, resolution-notes: (some resolution) })
    )
    (ok true)
  )
)

(define-public (update-recall-status (recall-id uint) (new-status (string-ascii 20)) (notes (optional (string-utf8 512))))
  (let ((recall (map-get? recalls { recall-id: recall-id })))
    (asserts! (is-some recall) (err ERR-INVALID-BATCH))
    (asserts! (is-owner tx-sender) (err ERR-UNAUTHORIZED))
    (asserts! (or (is-eq new-status "verified") (is-eq new-status "resolved") (is-eq new-status "disputed")) (err ERR-INVALID-STATUS))
    (map-set recalls
      { recall-id: recall-id }
      (merge (unwrap-panic recall) { status: new-status, resolution-notes: notes })
    )
    (if (is-eq new-status "resolved")
      (map-set batch-recall-status
        { batch-hash: (get batch-hash (unwrap-panic recall)) }
        (merge (unwrap-panic (map-get? batch-recall-status { batch-hash: (get batch-hash (unwrap-panic recall)) }))
          { active-recall: false })
      )
      (ok true)
    )
  )
)

(define-public (set-auto-recall-threshold (new-threshold uint))
  (begin
    (asserts! (is-owner tx-sender) (err ERR-UNAUTHORIZED))
    (asserts! (>= new-threshold MIN-REPORT-THRESHOLD) (err ERR-INVALID-THRESHOLD))
    (var-set auto-recall-threshold new-threshold)
    (ok true)
  )
)

(define-public (pause-contract)
  (begin
    (asserts! (is-owner tx-sender) (err ERR-UNAUTHORIZED))
    (var-set paused true)
    (ok true)
  )
)

(define-public (unpause-contract)
  (begin
    (asserts! (is-owner tx-sender) (err ERR-UNAUTHORIZED))
    (var-set paused false)
    (ok true)
  )
)

(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-owner tx-sender) (err ERR-UNAUTHORIZED))
    (var-set contract-owner new-owner)
    (ok true)
  )
)

(define-read-only (get-recall-details (recall-id uint))
  (map-get? recalls { recall-id: recall-id })
)

(define-read-only (get-batch-recall-status (batch-hash (buff 32)))
  (map-get? batch-recall-status { batch-hash: batch-hash })
)

(define-read-only (get-dispute-details (recall-id uint))
  (map-get? disputes { recall-id: recall-id })
)

(define-read-only (get-recall-verifier-vote (recall-id uint) (verifier principal))
  (map-get? recall-verifiers { recall-id: recall-id, verifier: verifier })
)

(define-read-only (get-recall-metadata (recall-id uint))
  (map-get? recall-metadata { recall-id: recall-id })
)

(define-read-only (get-auto-recall-threshold)
  (var-get auto-recall-threshold)
)

(define-read-only (get-contract-owner)
  (var-get contract-owner)
)

(define-read-only (is-contract-paused)
  (var-get paused)
)

(define-read-only (get-recall-counter)
  (var-get recall-counter)
)