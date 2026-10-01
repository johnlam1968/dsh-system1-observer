# Helpfulness Rubrics for System One/Jev-Style Agents

This document provides rubrics formatted for TypeSafe Jev's `choice`, `noul`, and `score` primitives.

## Found Rubrics

### 1. Choice-Based Helpfulness Rubric
**Source**: [MT-Bench Adapted](https://huggingface.co/datasets/SUSTech/mt_bench_judge)
**Type**: `choice`

```json
{
  "id": "helpfulness_choice",
  "type": "choice",
  "instructions": "Evaluate the helpfulness of the agent's response. Choose the most appropriate label.",
  "options": [
    {
      "label": "None",
      "description": "No helpful information provided."
    },
    {
      "label": "Poor",
      "description": "Response is unclear, irrelevant, or lacks actionable steps."
    },
    {
      "label": "Neutral",
      "description": "Response is partially helpful but lacks depth or clarity."
    },
    {
      "label": "Good",
      "description": "Response is relevant and actionable, but could be more detailed."
    },
    {
      "label": "Very Good",
      "description": "Response is highly relevant, clear, and actionable."
    },
    {
      "label": "Excellent",
      "description": "Response is exceptionally helpful with additional context or insights."
    }
  ]
}
```

### 2. Noul-Based Helpfulness Rubric
**Source**: [UltraFeedback-Inspired](https://arxiv.org/pdf/2605.30803v1)
**Type**: `noul`

```json
{
  "id": "helpfulness_noul",
  "type": "noul",
  "instructions": "Does the response provide useful, actionable information?",
  "criteria": {
    "helpfulness": true
  }
}
```

### 3. Score-Based Helpfulness Rubric
**Source**: [Prometheus Framework](https://huggingface.co/datasets/prometheus-eval/Feedback-Collection)
**Type**: `score`

```json
{
  "id": "helpfulness_score",
  "type": "score",
  "instructions": "Evaluate the helpfulness of the agent's response on a scale from poor to excellent.",
  "levels": [
    {
      "label": "Poor",
      "description": "Response is unclear, irrelevant, or lacks actionable steps."
    },
    {
      "label": "Neutral",
      "description": "Response is partially helpful but lacks depth or clarity."
    },
    {
      "label": "Good",
      "description": "Response is relevant and actionable, but could be more detailed."
    },
    {
      "label": "Very Good",
      "description": "Response is highly relevant, clear, and actionable."
    },
    {
      "label": "Excellent",
      "description": "Response is exceptionally helpful with additional context or insights."
    }
  ]
}
```

### 4. Jev-Style Custom Helpfulness Rubric
**Source**: [Jev Cookbook](https://github.com/Anil-matcha/awesome-jev-by-typesafe)
**Type**: `choice`

```json
{
  "id": "helpfulness_jev_style",
  "type": "choice",
  "instructions": "Evaluate the helpfulness of the agent's response based on decision alignment, risk mitigation, and actionability.",
  "options": [
    {
      "label": "None",
      "description": "No helpful information provided."
    },
    {
      "label": "Poor",
      "description": "Response is irrelevant to decision criteria and lacks actionability."
    },
    {
      "label": "Neutral",
      "description": "Response is partially relevant but lacks actionability or context."
    },
    {
      "label": "Good",
      "description": "Response is relevant and actionable but may lack detailed context."
    },
    {
      "label": "Very Good",
      "description": "Response is highly relevant, actionable, and contextually aware."
    },
    {
      "label": "Excellent",
      "description": "Response is highly relevant, actionable, contextually aware, and demonstrates appropriate expertise."
    }
  ]
}
```