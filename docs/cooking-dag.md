# Cooking Graph Data Model

This document is the operational reference for the persisted recipe model. It describes the current schema, invariants, mutation boundary, and extension rules without requiring the original implementation plan.

## Conceptual model

Each recipe owns one directed acyclic graph (DAG). The graph is bipartite:

```text
FoodState -> Operation -> FoodState
```

- A `FoodState` is a recipe-local food item at one point in the process: `raw carrots`, `peeled carrots`, or `roasted carrots`.
- An `Operation` is a transformation such as `peel`, `combine`, or `roast`.
- An `OperationInput` connects a required food state to an operation.
- An `OperationOutput` connects an operation to a produced food state.

Operations are nodes rather than edge labels because one operation can have multiple inputs, multiple outputs, instructions, duration, and type-specific configuration.

There are no direct food-state-to-food-state or operation-to-operation records. For traversal and cycle detection, an operation induces a dependency from every input food state to every output food state.

```text
A --+
    +--> combine --> C
B --+
```

The induced food-state dependencies are `A -> C` and `B -> C`.

## Source locations

| Concern | Source |
| --- | --- |
| Drizzle schema and inferred persistence models | `apps/backend/src/database/schema/recipes.ts` |
| Transaction-scoped graph loading and SQL mutations | `apps/backend/src/modules/recipes/recipe-graph-repository.ts` |
| Traversal, indexing, cycle detection, and validation | `apps/backend/src/modules/recipes/recipe-graph.ts` |
| Transactional mutation boundary | `apps/backend/src/modules/recipes/recipe-graph-service.ts` |
| Authenticated recipe HTTP routes | `apps/backend/src/modules/recipes/routes/` |
| Shared save and ingestion documents with client-safe validation | `packages/contracts/src/index.ts` |
| Recipe ingestion agent and workflow | `apps/backend/src/mastra/` |
| Authenticated ingestion preview route | `apps/backend/src/modules/recipe-imports/` |
| Domain tests | `apps/backend/src/modules/recipes/recipe-graph.test.ts` |
| PostgreSQL integration tests | `apps/backend/src/modules/recipes/recipe-graph.integration.test.ts` |

The Drizzle schema is authoritative. Types such as `Recipe`, `FoodState`, `Operation`, `OperationInput`, and `OperationOutput` are inferred with `$inferSelect` and `$inferInsert`; do not create handwritten persistence interfaces for the same rows.

## Tables

### `recipes`

Owns the graph and stores its authenticated owner, name, optional description, and timestamps. `owner_id` references `users`; owner-scoped reads and replacements return not-found for recipes owned by another user. Deleting a recipe cascades through its graph.

### `food_states`

Stores recipe-local food states:

- `recipe_id` owns the state.
- `name` is required and nonblank.
- `description` is optional prose.
- `metadata` is JSONB for experimental state properties that do not yet deserve stable columns.
- `position_x` and `position_y` store the editor's floating-point graph coordinates.
- `created_at` and `updated_at` are persisted instants.

A food state with no producing output connection is a **root**. A food state with no consuming input connection is **terminal**. These properties are derived and must not be stored as flags.

### `operations`

Stores transformations:

- `recipe_id` owns the operation.
- `type` is a required, nonblank string. It is intentionally not a PostgreSQL enum because operation types are expected to evolve.
- `name` and `instructions` are optional human-facing text.
- `estimated_duration_seconds` is optional and cannot be negative.
- `config` is JSONB for operation-specific structured data.
- `position_x` and `position_y` store the editor's floating-point graph coordinates.
- `created_at` and `updated_at` are persisted instants.

Keep broadly applicable fields as columns. Keep type-specific values in `config`, with application-level validation when a stable operation type is introduced. JSONB is persistence, not validation.

### `operation_inputs`

Connects `FoodState -> Operation` and stores:

- recipe, operation, and food-state IDs
- a deterministic `position` within the operation
- optional positive `quantity`
- optional string `unit`
- optional JSONB `metadata`

The persistence type for PostgreSQL `numeric` quantities is `string | null`; preserve that representation at the database boundary rather than coercing arbitrary-precision values through JavaScript numbers.

### `operation_outputs`

Connects `Operation -> FoodState` and has the same connection attributes as an input.

`UNIQUE (recipe_id, food_state_id)` limits every food state to at most one producing operation. Zero producers means the state is a recipe input/root. Multiple producers would introduce alternative-path semantics and are not supported by this model.

## Invariants

### Enforced by PostgreSQL

- Every graph row belongs to a recipe.
- Composite foreign keys require each connected operation and food state to belong to the connection's recipe.
- Duplicate input and output connections are rejected.
- Connection positions are unique within each operation and direction.
- A food state has at most one producer.
- Quantities are positive when present.
- Estimated durations are nonnegative when present.
- Deleting an operation deletes its input/output connections, not its food states.
- Deleting a food state deletes its input/output connections.
- Deleting a recipe deletes the complete graph.

The redundant-looking `recipe_id` on connection tables is intentional: it lets PostgreSQL reject cross-recipe edges with composite foreign keys.

### Enforced by the graph domain/service

- Every operation has at least one input.
- Every operation has at least one output.
- All in-memory graph references resolve.
- In-memory graph entities and connections have consistent recipe ownership.
- The induced food-state graph contains no directed cycle.

`validateRecipeGraph(graph)` returns either `{ valid: true }` or `{ valid: false, errors }`. Error codes include missing endpoints, cross-recipe data, duplicate connections, missing inputs/outputs, multiple producers, and cycles.

Database constraints and application validation are complementary. Do not remove a relational constraint because the domain validator checks the same concept.

## Mutation boundary

Use the exported `recipeGraphService` for graph changes. Do not insert, update, or delete topology rows directly from routes or unrelated application code.

The service exposes explicit domain operations:

```text
load
create
loadOwned
replace
createFoodState
updateFoodState
deleteFoodState
createOperation
updateOperation
deleteOperation
setOperationInputs
setOperationOutputs
addOperationInput
removeOperationInput
addOperationOutput
removeOperationOutput
```

Do not introduce a generic `createEdge(source, target)` API. Input and output semantics are deliberately distinct.

`createOperation` requires its initial inputs and outputs and writes all three parts atomically:

```typescript
await recipeGraphService.createOperation(recipeId, {
  type: "combine",
  instructions: "Toss until evenly coated.",
  inputs: [
    { foodStateId: choppedCarrotsId, quantity: "2", unit: "lb" },
    { foodStateId: oilId, quantity: "1", unit: "tbsp" },
  ],
  outputs: [{ foodStateId: seasonedCarrotsId }],
});
```

When `position` is omitted, set operations assign array order and add operations append after the current greatest position.

### Whole-document save

The browser persists a valid working graph through authenticated `POST /recipes` and `PUT /recipes/{recipeId}` requests. Node IDs are client-generated UUIDs. The shared `RecipeDocument` contract groups inputs and outputs under each operation; carries recipe and food-state descriptions, operation instructions and durations, connection quantities and units, and JSON metadata/config; and stores graph coordinates for every food state and operation.

`create` writes the recipe and its complete graph in one transaction. `replace` acquires the recipe advisory lock, verifies ownership, replaces all graph rows, reloads the aggregate, and validates it before commit. Invalid replacements roll back without changing the previously saved graph. `GET /recipes/{recipeId}` loads the owner-scoped aggregate and returns the same document shape so the frontend can restore all persisted recipe details, topology, and node positions.

All React Flow nodes use the same origin. Persisted coordinates are graph coordinates; viewport zoom, pan, selection, and undo history are not persisted.

### Written recipe ingestion

Authenticated `POST /recipe-imports/preview` accepts conventional recipe text and returns an unsaved `RecipeDocument` plus warnings. It never writes recipe rows. The browser loads the preview into the recipe builder, and the user must explicitly save through the ordinary recipe mutation boundary.

The Mastra workflow has two steps:

1. The recipe ingestion agent extracts a structured candidate with symbolic food-state keys, broad operation types, source step references, and explicit warnings for ambiguity.
2. Deterministic application code resolves keys to UUIDs, validates the DAG, uses ELK's rightward layered algorithm to assign non-overlapping graph positions, and preserves source quantity text in connection metadata when needed.

The model does not generate database identifiers or graph coordinates and has no persistence tools. Configure its model with `RECIPE_INGESTION_MODEL`; the default is `openai/gpt-5-mini`, which requires `OPENAI_API_KEY`. `RECIPE_INGESTION_TIMEOUT_MS` controls the per-model-call timeout and defaults to 180 seconds.

### Transaction and locking protocol

Every topology mutation follows this sequence:

1. Begin a PostgreSQL transaction.
2. Acquire a transaction-scoped advisory lock derived from the recipe ID.
3. Construct a repository bound to that transaction and perform the mutation.
4. Reload the complete recipe graph through the same repository.
5. Validate all graph invariants, including acyclicity.
6. Commit if valid; throw and roll back if invalid.

All new topology-changing service methods must use the same locked mutation path. This serializes structural changes to one recipe while allowing different recipes to change concurrently. Validating without the lock is unsafe: two individually valid concurrent changes could combine into a cycle.

`RecipeGraphRepository` instances are transaction-scoped. Construct them inside the transaction callback and do not retain or return them after that callback completes.

Metadata-only updates to existing food states and operations do not change topology and therefore do not require the recipe lock.

`RecipeGraphValidationError` exposes the validation errors that caused a rollback. Missing records use `RecipeGraphNotFoundError` or `RecipeGraphEntityNotFoundError`. PostgreSQL constraint errors may surface first when a relational invariant, such as a cross-recipe foreign key or one-producer uniqueness, is violated.

## Loading and traversing graphs

`loadRecipeGraph(recipeId)` and `recipeGraphService.load(recipeId)` return the complete aggregate in one consistent transaction:

```typescript
type RecipeGraph = {
  recipe: Recipe;
  foodStates: FoodState[];
  operations: Operation[];
  inputs: OperationInput[];
  outputs: OperationOutput[];
};
```

Recipe graphs are expected to be small. Prefer loading this aggregate over introducing a generic lazy graph abstraction.

Available pure utilities:

| Utility | Purpose |
| --- | --- |
| `buildRecipeGraphIndex` | Builds ID, producer, consumer, input, and output maps |
| `getRootFoodStates` | Returns states without a producer |
| `getTerminalFoodStates` | Returns states without a consumer |
| `getOperationDependencies` | Returns operations directly producing an operation's inputs |
| `getDownstreamFoodStates` | Traverses induced dependencies forward |
| `getUpstreamFoodStates` | Traverses induced dependencies backward |
| `topologicallySortFoodStates` | Returns a valid dependency order or `null` for a cycle |
| `hasRecipeGraphCycle` | Detects a directed cycle |
| `validateRecipeGraph` | Validates the complete aggregate without database access |

Keep these functions independent from PostgreSQL so graph behavior remains fast and directly testable.

## Deletion behavior

Cascades remove relationships, not semantically related food states:

- Deleting an operation leaves its former output states as roots and its former input states intact.
- Deleting a food state may remove required operation connections. The service reloads and validates afterward, so a deletion that leaves an operation without inputs or outputs rolls back.
- Deleting a recipe removes all owned graph rows.

Any future convenience method that deletes orphaned food states must be explicit. Do not hide that behavior in a cascade.

## Deliberately excluded concepts

Do not force these concepts into the graph tables:

- runtime execution status, start times, or completion times
- canonical/global ingredient identity
- equipment requirements or equipment scheduling
- nutrition, inventory, or grocery lists
- unit conversion
- recipe variants or alternative producing operations
- mass conservation

Execution state belongs in future run/session tables. Equipment is a resource, not a food state. Canonical ingredients may later be linked to food states without replacing them. Alternative paths need explicit choice semantics rather than weakening the one-producer invariant.

## Changing the model safely

1. Preserve the bipartite `FoodState -> Operation -> FoodState` structure unless the product requirement explicitly changes the domain model.
2. Decide whether each new invariant belongs in PostgreSQL, pure graph validation, or both.
3. Route every topology change through `recipeGraphService` and its recipe-scoped lock.
4. Update the Drizzle schema and continue inferring persistence models from it.
5. Cover new graph behavior in the pure tests; cover PostgreSQL constraints or transactions in integration tests.
6. Run TypeScript checks and the focused graph tests.
7. Generate a migration only when migration work was explicitly requested; follow `docs/database.md`.

From `apps/backend`, the focused checks are:

```sh
bun test src/modules/recipes/recipe-graph.test.ts
bun --env-file=../../.env test src/modules/recipes/recipe-graph.integration.test.ts
bun run typecheck
```

The integration tests require local PostgreSQL with committed migrations applied.
