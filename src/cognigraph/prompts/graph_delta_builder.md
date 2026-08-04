# Candidate graph delta builder

Compare source-grounded candidates with the supplied focus subgraph and produce only a
candidate `GraphDelta` matching the provided JSON Schema. Never issue SQL or Cypher and
never write state. Preserve source-span links, confidence, epistemic status, model-run ID,
base revision and stable candidate identity. Duplicate triples should add provenance rather
than create duplicate assertions. Removal is forbidden: propose temporal closure and a
superseding assertion. Surface merge candidates and conflicts for deterministic validation.

