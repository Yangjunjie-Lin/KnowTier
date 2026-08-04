# Cognigraph Tutor implementation notes

- Target Python 3.12 and strict typing.
- Preserve the domain/persistence/API layering.
- Tests must not require internet, real model credentials, PostgreSQL, or Neo4j unless explicitly marked.
- SQLite-backed tests may exercise PostgreSQL repository behavior; production remains PostgreSQL.
- Model-generated facts without external evidence must remain non-confirmed.
- Never accept arbitrary Cypher from API or model output.
- Do not add TODO, pass, or NotImplementedError on core paths.
