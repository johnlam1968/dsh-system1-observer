# Question-SDK Survey for System One / Jev-Style Questions

## Found SDKs

### 1. `@typesafe-ai/sdk` (npm)
- **Source**: [npm](https://registry.npmjs.org/@typesafe-ai/sdk)
- **Language**: TypeScript/JavaScript
- **License**: MIT
- **What it does**: TypeScript SDK for the TypeSafe API.
- **Question Building/Validation**: No explicit question-building or validation logic exposed in the package metadata or README.

### 2. `CutNBreak/typesafe-sdk-python` (GitHub)
- **Source**: [GitHub](https://github.com/CutNBreak/typesafe-sdk-python)
- **Language**: Python
- **License**: MIT
- **What it does**: Official Python SDK for TypeSafe API.
- **Question Building/Validation**:
  - **Schema**:
    - `Choice`: `id: str`, `type: str = "choice"`, `instructions: str`, `options: list[str]`
    - `Score`: `id: str`, `type: str = "score"`, `instructions: str`, `levels: list[str]`
  - **Liftable/Vendorable**: Yes, this SDK can be directly lifted or used as-is.

## Gaps in Literature

### 1. No Python SDK for TypeSafe
- **Search Query**: `typesafe_sdk` on PyPI
- **Result**: No package named `typesafe_sdk` exists on PyPI.

### 2. No Dedicated Question-Building Libraries for Jev
- **Search Query**: `jev question builder schema`
- **Result**: No open-source libraries explicitly designed for constructing or validating Jev-style questions (noul/choice/score) beyond the TypeSafe SDK.

---