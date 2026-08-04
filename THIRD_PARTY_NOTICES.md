# Third-Party Notices

This repository contains original integration code and does not vendor or modify third-party
source. Runtime and development packages are installed from their distributions. The following
direct dependencies are used under their upstream licenses; the installed distribution remains
the authoritative notice for the resolved version.

| Project | License |
| --- | --- |
| FastAPI, Pydantic, pydantic-settings, Typer, aiosqlite | MIT |
| SQLAlchemy, Alembic | MIT |
| asyncpg | Apache-2.0 |
| pgvector-python | MIT |
| Neo4j Python Driver | Apache-2.0 AND Python-2.0 |
| LiteLLM | MIT |
| LangGraph | MIT |
| Docling | MIT |
| PaddleOCR | Apache-2.0 |
| Pillow | MIT-CMU |
| python-docx, python-pptx | MIT |
| pypdf, RDFLib, Uvicorn | BSD-3-Clause |
| pySHACL | Apache-2.0 |
| structlog | MIT OR Apache-2.0 |
| python-json-logger | BSD-2-Clause |
| python-multipart | Apache-2.0 |
| greenlet | MIT AND PSF-2.0 |
| Hatchling | MIT |
| httpx | BSD-3-Clause |
| pytest, mypy, Ruff | MIT |
| pytest-asyncio | Apache-2.0 |
| types-python-dateutil / typeshed stubs | Apache-2.0 |
| uv | Apache-2.0 OR MIT |
| ReportLab | BSD-3-Clause |

Container and external runtime components are not copied into the Python wheel:

| Component | Distribution role | License |
| --- | --- | --- |
| PostgreSQL 16 | `pgvector/pgvector:pg16` base server | PostgreSQL License |
| pgvector server extension | Included in the PostgreSQL image | PostgreSQL License |
| Neo4j 5.26 Community Server | `neo4j:5.26-community` semantic projection | GPL-3.0 |
| uv Python 3.12 Debian image | API build/runtime base | Apache-2.0 OR MIT for uv; bundled Debian components retain their own notices |
| PaddlePaddle 3 | User-installed optional PaddleOCR runtime | Apache-2.0 |

The resolved `uv.lock` contains transitive packages whose distribution metadata and license
files remain authoritative. A redistributed container image should preserve those files and
produce a version-specific SBOM/license report as part of its release process. No source from
Tutor-GPT, OATutor, GraphRAG, Graphiti, llm-graph-builder, docling-graph, or pyKT is copied into
this project.
