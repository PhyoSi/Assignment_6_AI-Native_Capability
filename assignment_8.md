# Assignment A6: Build and Integrate an AI Decision Capability

**Course:** Platform Development  
**Week:** 08 — AI-Native Capability Design  
**Type:** Individual Assignment  
**Total:** 100 Points

## Objective

Design and implement one small AI decision capability for a software platform using Jev (or an equivalent decision model).

The capability must solve a clearly defined problem, return structured results, and handle failures safely.

## Task 1 — Define Your AI Capability (20 points)

Choose one decision-making problem relevant to a software platform.

Examples:
- Student support ticket routing
- Customer inquiry classification
- Product category classification
- Service request prioritization
- FAQ intent classification

Describe:

1. What problem does the capability solve?
2. What input does it receive?
3. What output does it produce?
4. Why is an AI model appropriate instead of deterministic rules?

## Task 2 — Implement and Test the Decision (30 points)

Use Jev Playground or Jev API to implement the capability.

Requirements:

- At least 3 possible output choices
- At least 5 different test inputs
- Structured output with a clearly defined schema
- Evidence of actual model execution

Submit your decision configuration or source code and the observed outputs.

## Task 3 — Design Integration and Fallback (30 points)

Explain how the capability would integrate into a software platform.

Provide:

- A simple architecture diagram showing the user, application, decision capability, and downstream action
- An example API request and response
- Input/output validation rules
- A deterministic fallback for invalid results, model failure, or unavailable service

If using Jev Playground only, provide a clear integration design and executable or pseudocode fallback logic.

If using an API, demonstrate at least one fallback scenario.

## Task 4 — Engineering Reflection (20 points)

Answer briefly:

1. What worked well?
2. What mistakes or unexpected decisions did the model make?
3. What are the risks of using this capability in production?
4. What would you improve next?

## Submission

Submit one PDF report and supporting files or links.

Required evidence:
- Decision configuration or source code
- At least 5 test inputs and actual outputs
- Architecture diagram
- Fallback design or demonstration
- Engineering reflection

**Suggested filename:** `A6_StudentID.pdf`

**Important:** Do not submit API keys, access tokens, or private user data.
