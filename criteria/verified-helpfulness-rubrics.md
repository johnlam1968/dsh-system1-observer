# Verified Helpfulness Rubrics for AI Agent Jobs

This document compiles verified rubrics for evaluating whether an AI agent's responses are helpful, based on real-world literature and DSH integration.

## Found Rubrics

### 1. MT-Bench (Revised for Helpfulness)
**Source**: [SUSTech MT-Bench](https://huggingface.co/datasets/SUSTech/mt_bench_judge)
**Type**: **Choice** (5-point scale: Poor, Neutral, Good, Very Good, Excellent)
**Dimensions**:
- **Actionability**: Does the response provide clear, executable steps?
- **Relevance**: Does the response directly address the task’s requirements?
- **Clarity**: Is the response easy to understand?
- **Helpfulness**: Does the response provide meaningful insights or solutions?
- **Trustworthiness**: Is the response factually accurate?

### 2. Prometheus Framework (Helpfulness Focus)
**Source**: [Prometheus-Eval Feedback Collection](https://huggingface.co/datasets/prometheus-eval/Feedback-Collection)
**Type**: **Score** (1-5 scale)
**Dimensions**:
- **Adherence to Task**: Does the response strictly follow the task’s instructions?
- **Helpfulness**: Does the response provide useful, actionable information?
- **Clarity**: Is the response easy to understand?
- **Accuracy**: Is the response factually correct?
- **Contextual Relevance**: Does the response consider the broader context?

### 3. UltraFeedback (Rationale-Based)
**Source**: [UltraFeedback Dataset](arXiv:2605.30803)
**Type**: **Score** (Rationale per dimension)
**Dimensions**:
- **Adheres to Input Specifications**: Does the response strictly follow the user’s input?
- **Helpfulness**: Does the response provide useful, actionable information?
- **Clarity**: Is the response easy to understand?
- **Accuracy**: Is the response factually correct?
- **Relevance**: Does the response directly address the user’s query?

**Example Rationale**:
- *The response provides actionable steps but lacks context about potential trade-offs.*
- *The response is clear but does not address the user’s specific constraints.*

### 4. Jev-Style Helpfulness Rubric (Custom for System One)
**Source**: [Jev Cookbook](https://github.com/Anil-matcha/awesome-jev-by-typesafe)
**Type**: **Choice** (Task-specific scoring)
**Dimensions**:
- **Decision Alignment**: Does the response align with the user’s decision criteria?
- **Risk Mitigation**: Does the response consider potential risks?
- **Contextual Awareness**: Does the response account for constraints or trade-offs?
- **Helpfulness**: Does the response provide meaningful, actionable information?

**Schema for Question Validation**:
```python
from pydantic import BaseModel

class JevHelpfulnessQuestion(BaseModel):
    id: str
    type: str = "helpfulness"
    instructions: str
    criteria: dict = {
        "decision_alignment": bool,
        "risk_mitigation": bool,
        "contextual_awareness": bool,
        "actionable": bool
    }
```

---