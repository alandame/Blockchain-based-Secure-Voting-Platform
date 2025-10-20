(define-constant ERR-ELECTION-NOT-FOUND u200)
(define-constant ERR-VOTER-INELIGIBLE u201)
(define-constant ERR-ELECTION-NOT-ACTIVE u202)
(define-constant ERR-VOTER-ALREADY-VOTED u203)
(define-constant ERR-INVALID-VOTE u204)
(define-constant ERR-VOTE-CAST-FAILED u205)
(define-constant ERR-INVALID-PROOF u206)
(define-constant ERR-VOTE-NOT-FOUND u207)
(define-constant ERR-WRONG-CANDIDATE u208)
(define-constant ERR-VOTER-TOKEN-NOT-BURNED u209)

(define-data-var next-vote-id uint u0)
(define-data-var election-admin (optional principal) none)
(define-data-var voter-registry (optional principal) none)
(define-data-var voter-token (optional principal) none)

(define-map votes
  uint
  {
    election-id: uint,
    voter: principal,
    candidate-id: uint,
    encrypted-ballot: (buff 128),
    proof-hash: (buff 32),
    timestamp: uint,
    nonce: uint,
    status: bool
  }
)

(define-map voter-votes
  {election-id: uint, voter: principal}
  uint
)

(define-read-only (get-vote (vote-id uint))
  (map-get? votes vote-id)
)

(define-read-only (has-voted (election-id uint) (voter principal))
  (is-some (map-get? voter-votes {election-id: election-id, voter: voter}))
)

(define-read-only (get-vote-count (election-id uint))
  (let (
    (total (fold get-election-vote-count u0 {election-id: election-id}))
  )
    total
  )
)

(define-private (get-election-vote-count (acc uint) (vote {election-id: uint}))
  (if (is-eq (get election-id vote) (get election-id vote))
      (+ acc u1)
      acc
  )
)

(define-public (set-dependencies
  (admin-contract principal)
  (registry-contract principal)
  (token-contract principal)
)
  (begin
    (asserts! (is-none (var-get election-admin)) (err u210))
    (asserts! (is-none (var-get voter-registry)) (err u211))
    (asserts! (is-none (var-get voter-token)) (err u212))
    (var-set election-admin (some admin-contract))
    (var-set voter-registry (some registry-contract))
    (var-set voter-token (some token-contract))
    (ok true)
  )
)

(define-public (cast-vote
  (election-id uint)
  (candidate-id uint)
  (encrypted-ballot (buff 128))
  (proof-hash (buff 32))
  (nonce uint)
)
  (let (
    (voter tx-sender)
    (vote-id (var-get next-vote-id))
    (admin (unwrap! (var-get election-admin) (err ERR-ELECTION-NOT-FOUND)))
    (registry (unwrap! (var-get voter-registry) (err u213)))
    (token (unwrap! (var-get voter-token) (err u214)))
  )
    (try! (contract-call? admin is-election-active election-id))
    (try! (contract-call? registry is-voter-eligible election-id voter))
    (asserts! (not (has-voted election-id voter)) (err ERR-VOTER-ALREADY-VOTED))
    (asserts! (> (len encrypted-ballot) u0) (err ERR-INVALID-VOTE))
  ;; proof-hash should be exactly 32 bytes long
  (asserts! (is-eq (len proof-hash) u32) (err ERR-INVALID-PROOF))
    (try! (contract-call? token burn-voting-token election-id voter))
    (map-set votes vote-id
      {
        election-id: election-id,
        voter: voter,
        candidate-id: candidate-id,
        encrypted-ballot: encrypted-ballot,
        proof-hash: proof-hash,
        timestamp: block-height,
        nonce: nonce,
        status: true
      }
    )
    (map-set voter-votes {election-id: election-id, voter: voter} vote-id)
    (var-set next-vote-id (+ vote-id u1))
    (print {event: "vote-cast", vote-id: vote-id, election-id: election-id})
    (ok vote-id)
  )
)

(define-public (verify-vote
  (vote-id uint)
  (expected-candidate uint)
  (expected-proof (buff 32))
)
  (let (
    (vote-opt (map-get? votes vote-id))
  )
    (match vote-opt
      vote
        (begin
          (asserts! (get status vote) (err ERR-VOTE-NOT-FOUND))
          (asserts! (is-eq (get candidate-id vote) expected-candidate) (err ERR-WRONG-CANDIDATE))
          (asserts! (is-eq (get proof-hash vote) expected-proof) (err ERR-INVALID-PROOF))
          (ok {
            election-id: (get election-id vote),
            voter: (get voter vote),
            timestamp: (get timestamp vote),
            verified: true
          })
        )
      (err ERR-VOTE-NOT-FOUND)
    )
  )
)

(define-public (challenge-vote (vote-id uint))
  (let (
    (vote-opt (map-get? votes vote-id))
  )
    (match vote-opt
      vote
        (begin
          (asserts! (get status vote) (err ERR-VOTE-NOT-FOUND))
          (map-set votes vote-id
            {
              election-id: (get election-id vote),
              voter: (get voter vote),
              candidate-id: (get candidate-id vote),
              encrypted-ballot: (get encrypted-ballot vote),
              proof-hash: (get proof-hash vote),
              timestamp: (get timestamp vote),
              nonce: (get nonce vote),
              status: false
            }
          )
          (print {event: "vote-challenged", vote-id: vote-id})
          (ok true)
        )
      (err ERR-VOTE-NOT-FOUND)
    )
  )
)

(define-read-only (get-voter-vote (election-id uint) (voter principal))
  (map-get? voter-votes {election-id: election-id, voter: voter})
)