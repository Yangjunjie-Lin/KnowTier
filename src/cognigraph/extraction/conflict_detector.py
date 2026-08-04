from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from cognigraph.domain.enums import ConflictType
from cognigraph.domain.graph import RelationAssertion
from cognigraph.graph.delta import AssertionCreate


@dataclass(frozen=True, slots=True)
class DetectedConflict:
    conflict_type: ConflictType
    existing_assertion_id: UUID
    candidate_assertion_id: UUID
    should_supersede: bool
    description: str


class ConflictDetector:
    def detect(
        self,
        candidate: AssertionCreate,
        existing: list[RelationAssertion],
        *,
        temporal: bool,
    ) -> list[DetectedConflict]:
        conflicts: list[DetectedConflict] = []
        for assertion in existing:
            if not assertion.is_active or assertion.subject_id != candidate.subject_id:
                continue
            if assertion.predicate_key is not candidate.predicate_key:
                continue
            if assertion.object_id == candidate.object_id:
                conflicts.append(
                    DetectedConflict(
                        ConflictType.DUPLICATE_ASSERTION,
                        assertion.id,
                        candidate.id,
                        False,
                        "The same active subject-predicate-object assertion already exists.",
                    )
                )
            elif temporal:
                conflicts.append(
                    DetectedConflict(
                        ConflictType.TEMPORAL_REPLACEMENT,
                        assertion.id,
                        candidate.id,
                        True,
                        "A temporal relation has a newer competing object.",
                    )
                )
            else:
                conflicts.append(
                    DetectedConflict(
                        ConflictType.COMPETING_OBJECT,
                        assertion.id,
                        candidate.id,
                        False,
                        "A non-temporal relation has competing objects; both must be retained.",
                    )
                )
        return conflicts
