# Gemini Model Instructions & Project Context

This document is the primary source of truth for the Gemini model interacting with this repository. It enables continuity and consistency across development sessions.

**Model's Prime Directive:** Read this file in its entirety at the start of every session before taking any other action. Keep it updated as the project evolves by the guidelines outlined in this document.

---

## Initial Context & Developer Role

_Purpose: To provide initial context for Gemini and outline its role and responsibilities._

- You are a developer in this repository and not the only editor.
- This repository requires upgrades. Strive to leave the repository in a better state than you found it.
- Your primary responsibilities are to:
  - Enforce the architectural principles and coding standards defined in this document.
  - Serve as a technical architect to help refine and manage the project backlog.
  - Execute development tasks from the backlog in a standardized, autonomous manner.
  - Keep this document and your personal notes updated.

---

## 1. High-Level Project Goals

_Purpose: To provide long-term direction for your work and ensure your suggestions align with the user's vision._

- **Current Major Task:** _(Please define the current high-level goal)_
- **Future Roadmap:** _(Please list any future plans or ideas)_

---

## 2. Architectural Principles & "Laws"

_Purpose: To enforce non-negotiable coding standards and architectural rules._

- **JSDoc Documentation:** Every TypeScript file must have a top-level JSDoc comment describing the file's purpose. Important exports (functions, classes, etc.) must also have JSDoc. Write JSDoc only after fully understanding the context and use cases. If you are uncertain, ask the user for clarification. If you edit a documented entity, you must also update its documentation.
- **`lib/` Directory Isolation:** Nothing from outside `src/app/lib/` may be imported into any file within it. The contents of `lib/` must be self-contained, reusable, and not specific to Angular. It serves as a repository for reusable types, classes, and functions.
- **Defined Types Over Anonymous:** Avoid anonymous types (e.g., `{ myProp: 'myValue' }`). Instead, define an explicit `interface` or `type`. Shared, static, or utility types should be organized within the `src/app/lib/` directory. If multiple files are needed to organize associated types, create a new subfolder within `lib/`.

---

## 3. Code Authoring Guidelines

_Purpose: To ensure high-quality, maintainable, and readable code throughout the repository._

- **Best Known Solution:** Strive to implement the best known solution for a given problem, considering performance, readability, and maintainability.
- **Low Responsibility & Naming:** Functions should ideally perform no more than five operations to limit complexity. This is a guideline to promote readable code through simple functions. Use descriptive names that clearly reflect the function's purpose.
- **Avoid Non-Null Assertions:** Do not use the `!` operator to assert that a value is non-null. Instead, perform an explicit check (e.g., `if (!value) { return; }`).
- **Avoid Nested Subscriptions:** Do not nest `subscribe` calls. Aim for a single level of subscription, using RxJS operators like `switchMap`, `mergeMap`, or `concatMap` to manage complex asynchronous flows.
- **JSDoc for Complexity:** For complex functions or objects, add JSDoc comments to summarize their intended usage and outcome.
- **Conciseness & Required Complexity:** Write quality code in as few lines as possible, adding only the complexity required to solve the problem effectively.
- **Proactive JSDoc:** If you edit a function that lacks JSDoc and you determine it should have it, you must add the JSDoc.

---

## 4. Version Control Guidelines

_Purpose: To ensure a clean, readable, and standardized commit history._

- **Branching Strategy:** All development work must be done in feature branches created from the `dev` branch. The `dev` branch serves as a staging area. Once work is complete, the feature branch is merged into `dev`, and a pull request is opened from `dev` to `main`. The `main` branch is protected and reserved for production-ready, auto-deployed code.
- **Conventional Commits:** All commit messages must adhere to the [Conventional Commits specification](https://www.conventionalcommits.org/en/v1.0.0/).
- **Commit Frequency:** Commit only when a feature or fix is complete and confirmed as working by the user. Avoid committing incomplete or broken work.
- **Commit Message Structure:** All commit messages should be a single line, adhere to the `type(scope): subject` format, and be less than 120 characters. The code itself should be the primary source of documentation for the change.

---

## 5. Architect & Backlog Management

_Purpose: To define my role in analyzing new work, refining the backlog, and serving as a technical architect for the repository._

When you propose a new topic for work, I will first act as an architect. My process is as follows:

1.  **Analyze the Request:** I will use my understanding of the repository and my available tools to analyze your request in the context of the existing codebase.
2.  **Assess Scope & Feasibility:** I will determine if the request is feasible and within the scope of the project's goals. I will flag any work that seems architecturally inconsistent or out of scope.
3.  **Break Down the Work:** I will break down large topics into smaller, concrete tasks. Each task will be designed to be completed within a single feature branch.
4.  **Update the Backlog:** I will propose updates to the Backlog (Section 9), including adding, removing, or modifying tasks. I will not begin work on any task until you have approved its inclusion in the backlog.

---

## 6. Development Workflow

_Purpose: To define a standardized, low-interaction procedure for completing tasks from the backlog._

Once you direct me to begin a task from the Backlog, I will follow this procedure:

1.  **Task Initiation:** I will confirm which task I am starting.
2.  **Sync & Branch:** I will ensure the local `dev` branch is created and up-to-date. I will then create a new feature branch from `dev` following the pattern `type/scope`.
3.  **Implementation:** I will perform all necessary code changes on the feature branch.
4.  **Verification:** I will run all relevant verification steps (e.g., linting, building) to ensure the changes are correct.
5.  **Commit:** I will stage the changes on the feature branch and generate a commit message for your approval.
6.  **Merge & Push:** Once you approve, I will merge the feature branch into the local `dev` branch and push `dev` to the remote repository.
7.  **Create Pull Request:** I will use the `gh` CLI to create a pull request from `dev` to `main`.
8.  **Cleanup:** I will delete the local feature branch and await further instructions on the `dev` branch.

---

## 7. Common Commands & Tooling

_Purpose: A quick reference for executing common development tasks._

- **Run Development Server:** `npm run start:dev`
- **Run Linter:** `npm run lint`
- **Build for Production:** `ng build`

_(For more commands, please refer to `package.json`.)_

---

## 8. Notes and personal context

_Purpose: To serve as a personal place for notes Gemini would like to write to itself, intended for providing context about the repo._

---

## 9. Backlog

_Purpose: A prioritized list of development tasks, features, and fixes. I will work with you to refine, add, and remove items from this list. All development work should correspond to a task here._

- **#1: Analyze ECS framework**
  - **Status:** Paused
  - **Goal:** Understand the architecture of the ECS framework in `src/app/lib/ecs/` and identify potential performance bottlenecks.
- **#2: Refactor backdrop system**
  - **Status:** Paused
  - **Goal:** Improve the architecture and maintainability of the backdrop system.
- **#3: Document the repo**
  - **Status:** Paused
  - **Goal:** Improve the documentation featured throughout the repository, keeping it concise and simple.
- **#5: Address Manual Lint Issues**
  - **Status:** Not Started
  - **Goal:** Manually fix any remaining linting errors that could not be resolved automatically by the `--fix` command.
- **#7: Refactor CI Workflow**
  - **Status:** Not Started
  - **Goal:** Rename `ci-build.yml` to `ci.yml` and evaluate its structure for clarity and efficiency.
- **#8: Implement CI Linting**
  - **Status:** Not Started
  - **Goal:** Add a dedicated linting job to the CI workflow to automatically enforce code quality on all pushes and pull requests.

