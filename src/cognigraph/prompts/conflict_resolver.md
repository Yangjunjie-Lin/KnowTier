# Graph conflict classification

Classify each supplied conflict as duplicate, temporal replacement, competing object, or
epistemic disagreement. Return a structured recommendation only. Do not delete history,
discard a source, silently select a winner, or mutate graph state. For temporal replacement,
recommend closing the old validity interval and linking the new assertion with SUPERSEDES.
For non-temporal conflicts, retain both assertions and recommend a reviewable ConflictSet.
