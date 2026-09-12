# Cooking DAG Design

**Status:** Proposed
**Purpose:** Define the persistence and domain model for representing cooking processes as directed acyclic graphs in PostgreSQL.

## 1. Overview

A recipe is modeled as a directed acyclic graph (DAG) describing how food changes from its initial state into its final state.

The graph is **bipartite** and contains two kinds of nodes:

1. **FoodState** — a food item, ingredient, mixture, or intermediate product in a particular state.
2. **Operation** — an action performed on one or more `FoodState` nodes to produce one or more new `FoodState` nodes.

Graph connections always have one of these forms:

```text
FoodState -> Operation
Operation -> FoodState
```

There are never direct:

```text
FoodState -> FoodState
Operation -> Operation
```

relationships.

For example:

```text
Raw carrots
    |
    v
  [peel]
    |
    v
Peeled carrots
    |
    v
  [chop]
    |
    v
Chopped carrots ------+
Salt -----------------+
Pepper ---------------+--> [combine] --> Seasoned carrots on sheet pan
Oil ------------------+                         |
                                                v
                                             [roast]
                                                |
                                                v
                                         Roasted carrots
```

Making operations first-class nodes rather than edge labels is important because cooking operations commonly have:

- multiple inputs,
- multiple outputs,
- operation-specific configuration,
- duration,
- instructions,
- temperature,
- equipment requirements,
- execution state.

A traditional edge-labeled graph does not model these cases cleanly.

---

## 2. Goals

The model should:

- represent a recipe as a DAG,
- support one-to-one, many-to-one, one-to-many, and many-to-many transformations,
- make intermediate food states explicit,
- support traversing both forward and backward through a recipe,
- support determining operation dependencies,
- eventually support recipe scheduling and execution,
- prevent operations from creating cycles,
- keep graph structure independent from runtime execution state,
- avoid prematurely modeling every possible cooking concept.

The initial schema should be simple enough to evolve as the cooking domain becomes better understood.

---

## 3. Non-goals

The initial implementation does **not** attempt to fully model:

- nutritional information,
- ingredient substitutions,
- unit conversion,
- density-based volume/weight conversion,
- inventory management,
- grocery lists,
- equipment scheduling,
- alternative recipe paths,
- canonical ingredient ontology,
- recipe versioning,
- runtime cooking sessions,
- mass conservation,
- automatic natural-language recipe parsing.

These features should be layered on top of the graph rather than changing its fundamental structure.

---

# 4. Core Domain Model

## 4.1 Recipe

A `Recipe` owns one cooking graph.

Every `FoodState`, `Operation`, and connection belongs to exactly one recipe.

Graph relationships may never cross recipe boundaries.

```text
Recipe
  |
  +-- FoodStates
  |
  +-- Operations
  |
  +-- OperationInputs
  |
  +-- OperationOutputs
```

This ownership boundary is important both for integrity and for efficient graph traversal.

---

## 4.2 FoodState

A `FoodState` represents a food item or collection of food at a particular point in the cooking process.

Examples:

```text
raw carrots
peeled carrots
chopped carrots
salt
olive oil
seasoned carrots
roasted carrots
pizza dough
rolled pizza dough
tomato sauce
assembled pizza
baked pizza
```

A `FoodState` is **recipe-local**.

It should not initially represent a canonical global concept such as:

```text
CARROT
SALT
OLIVE_OIL
```

For example, two recipes may each have a `FoodState` called `chopped carrots`. These are independent graph nodes.

A global ingredient taxonomy may eventually be added:

```text
IngredientDefinition
    ^
    |
FoodState
```

but it should not be required by the initial graph model.

This distinction prevents ingredient taxonomy concerns from becoming coupled to graph structure.

---

## 4.3 Operation

An `Operation` represents a transformation or cooking action.

Examples include:

```text
peel
chop
slice
dice
combine
mix
whisk
knead
divide
season
roast
bake
boil
simmer
saute
fry
grill
rest
cool
strain
blend
```

An operation may have multiple inputs and multiple outputs.

Example:

```text
whole chicken
      |
      v
 [break_down]
   /   |   \
  v    v    v
breast thigh carcass
```

An operation is therefore a graph node, not an edge attribute.

Operations should initially use a string `type` rather than a PostgreSQL enum. The set of operation types is expected to evolve frequently.

Validation of known operation types can occur in the application layer.

---

# 5. Graph Relationships

Two relationship types exist.

## OperationInput

```text
FoodState -> Operation
```

An `OperationInput` indicates that a food state is required by an operation.

For example:

```text
chopped carrots --+
salt ------------+
pepper ----------+--> combine
olive oil -------+
```

## OperationOutput

```text
Operation -> FoodState
```

An `OperationOutput` represents a food state produced by an operation.

For example:

```text
combine --> seasoned carrots
```

Together:

```text
chopped carrots --+
salt ------------+
pepper ----------+--> [combine] --> seasoned carrots
olive oil -------+
```

---

# 6. Relational Schema

The following SQL describes the intended relational model. Application migrations may express the same constraints using the project's database tooling.

```sql
CREATE TABLE recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name TEXT NOT NULL,
    description TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Food states

```sql
CREATE TABLE food_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    recipe_id UUID NOT NULL
        REFERENCES recipes(id)
        ON DELETE CASCADE,

    name TEXT NOT NULL,
    description TEXT,

    metadata JSONB NOT NULL DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (recipe_id, id)
);

CREATE INDEX food_states_recipe_id_idx
    ON food_states(recipe_id);
```

`metadata` exists for experimental properties that do not yet justify first-class columns.

Core domain concepts should eventually be promoted out of JSONB when their semantics stabilize.

---

## Operations

```sql
CREATE TABLE operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    recipe_id UUID NOT NULL
        REFERENCES recipes(id)
        ON DELETE CASCADE,

    type TEXT NOT NULL,

    name TEXT,
    instructions TEXT,

    estimated_duration_seconds INTEGER
        CHECK (
            estimated_duration_seconds IS NULL
            OR estimated_duration_seconds >= 0
        ),

    config JSONB NOT NULL DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (recipe_id, id)
);

CREATE INDEX operations_recipe_id_idx
    ON operations(recipe_id);
```

The `config` column contains operation-specific configuration.

For example:

```json
{
  "temperature_f": 425
}
```

for:

```text
ROAST
```

or:

```json
{
  "size": "1/2 inch"
}
```

for:

```text
CHOP
```

Fields common to nearly all operations should be real columns rather than being placed in `config`.

---

# 7. Operation Inputs

```sql
CREATE TABLE operation_inputs (
    recipe_id UUID NOT NULL,

    operation_id UUID NOT NULL,
    food_state_id UUID NOT NULL,

    position INTEGER NOT NULL DEFAULT 0,

    quantity NUMERIC,
    unit TEXT,

    metadata JSONB NOT NULL DEFAULT '{}',

    PRIMARY KEY (operation_id, food_state_id),

    UNIQUE (operation_id, position),

    FOREIGN KEY (recipe_id, operation_id)
        REFERENCES operations(recipe_id, id)
        ON DELETE CASCADE,

    FOREIGN KEY (recipe_id, food_state_id)
        REFERENCES food_states(recipe_id, id)
        ON DELETE CASCADE,

    CHECK (
        quantity IS NULL
        OR quantity > 0
    )
);

CREATE INDEX operation_inputs_food_state_idx
    ON operation_inputs(recipe_id, food_state_id);
```

Including `recipe_id` in this table may appear redundant, but it allows PostgreSQL foreign keys to guarantee that the `Operation` and `FoodState` belong to the same recipe.

Cross-recipe graph edges are therefore impossible.

`position` provides deterministic ordering for UI and recipe rendering.

For example:

```text
0  chopped carrots
1  olive oil
2  salt
3  pepper
```

Ordering is presentation metadata and has no effect on graph semantics.

---

# 8. Operation Outputs

```sql
CREATE TABLE operation_outputs (
    recipe_id UUID NOT NULL,

    operation_id UUID NOT NULL,
    food_state_id UUID NOT NULL,

    position INTEGER NOT NULL DEFAULT 0,

    quantity NUMERIC,
    unit TEXT,

    metadata JSONB NOT NULL DEFAULT '{}',

    PRIMARY KEY (operation_id, food_state_id),

    UNIQUE (operation_id, position),

    FOREIGN KEY (recipe_id, operation_id)
        REFERENCES operations(recipe_id, id)
        ON DELETE CASCADE,

    FOREIGN KEY (recipe_id, food_state_id)
        REFERENCES food_states(recipe_id, id)
        ON DELETE CASCADE,

    CHECK (
        quantity IS NULL
        OR quantity > 0
    ),

    UNIQUE (recipe_id, food_state_id)
);

CREATE INDEX operation_outputs_operation_idx
    ON operation_outputs(recipe_id, operation_id);
```

The following constraint is intentional:

```sql
UNIQUE (recipe_id, food_state_id)
```

A `FoodState` may have at most **one producing operation**.

This produces straightforward graph semantics:

```text
zero producers -> root/input food state

one producer   -> intermediate or final food state
```

Allowing multiple producers would implicitly introduce OR dependencies:

```text
operation A --+
              +--> same FoodState
operation B --+
```

That represents alternative execution paths rather than a normal DAG dependency.

Alternative cooking methods should be modeled separately if the product eventually supports them.

---

# 9. Quantities

Quantities are initially associated with an operation's use or production of a food state.

Example:

```text
2 lb chopped carrots --+
1 tbsp olive oil ------+--> combine
1 tsp salt ------------+
0.5 tsp pepper --------+
```

This becomes:

```text
operation_inputs

food_state       quantity    unit
---------------------------------
chopped carrots  2           lb
olive oil        1           tbsp
salt             1           tsp
pepper           0.5         tsp
```

Output quantities are optional because many transformations do not have a useful or known output quantity.

For example:

```text
2 lb raw carrots
    |
   peel
    |
peeled carrots
```

The recipe author should not be required to calculate the exact weight of the peeled carrots.

Units should initially remain strings.

A formal unit system can be introduced later once conversion requirements are known.

---

# 10. Derived Graph Concepts

Several useful concepts should **not** be stored as boolean columns because they can be derived from graph structure.

## Root food state

A food state with no producing operation.

```text
NOT EXISTS operation_outputs WHERE food_state_id = X
```

Typical roots:

```text
raw carrots
salt
pepper
olive oil
flour
water
```

Do not add:

```text
food_states.is_root
```

unless a future requirement demonstrates that materializing this value is necessary.

---

## Terminal food state

A food state that is not consumed by any operation.

```text
NOT EXISTS operation_inputs WHERE food_state_id = X
```

For example:

```text
roasted carrots
```

may be a terminal state.

A recipe could have multiple terminal food states.

---

## Intermediate food state

A food state that has both:

- a producing operation,
- at least one consuming operation.

For example:

```text
chopped carrots
```

---

# 11. DAG Semantics

Although the physical schema is bipartite:

```text
FoodState -> Operation -> FoodState
```

cycle detection can treat every operation as inducing dependencies directly between food states.

Given:

```text
A ----+
      +--> Operation X --> C
B ----+
```

the induced dependencies are:

```text
A -> C
B -> C
```

An operation with inputs:

```text
I1
I2
I3
```

and outputs:

```text
O1
O2
```

induces:

```text
I1 -> O1
I1 -> O2

I2 -> O1
I2 -> O2

I3 -> O1
I3 -> O2
```

The cooking graph is valid if this induced food-state graph is acyclic.

This representation should be used for cycle detection and topological sorting.

---

# 12. Graph Invariants

Every valid recipe graph must satisfy the following rules.

## Structural invariants

1. Every graph entity belongs to exactly one recipe.
2. Connections may never cross recipe boundaries.
3. `FoodState -> FoodState` edges do not exist.
4. `Operation -> Operation` edges do not exist.
5. An operation has at least one input.
6. An operation has at least one output.
7. A food state has at most one producing operation.
8. Duplicate input connections are not allowed.
9. Duplicate output connections are not allowed.
10. The graph must contain no directed cycles.

The schema directly enforces most of these.

The application graph service must enforce the invariants that cannot conveniently be expressed using normal relational constraints.

---

# 13. Cycle Prevention

Consider:

```text
A -> [op1] -> B
B -> [op2] -> C
```

Adding:

```text
C -> [op3] -> A
```

must fail.

The graph mutation service should validate acyclicity before committing structural changes.

Because recipe graphs are expected to be relatively small, the preferred initial implementation is:

1. begin a database transaction,
2. obtain a transaction-scoped lock for the recipe,
3. perform the proposed graph mutation,
4. load the recipe's input/output relationships,
5. construct the induced `FoodState -> FoodState` dependency graph,
6. run a standard cycle detection algorithm,
7. roll back if a cycle exists,
8. otherwise commit.

Either DFS cycle detection or Kahn's topological-sort algorithm is appropriate.

Kahn's algorithm has a useful property:

```text
if number_of_processed_nodes != total_nodes:
    graph contains a cycle
```

Complexity is:

```text
O(V + E)
```

which is insignificant for normal recipe-sized graphs.

---

# 14. Concurrent Graph Mutations

Cycle validation introduces a concurrency issue.

For example, two transactions could each independently make a valid graph mutation while their combined result creates a cycle.

Structural mutations for a particular recipe must therefore be serialized.

An appropriate PostgreSQL approach is a transaction-scoped advisory lock.

Conceptually:

```sql
SELECT pg_advisory_xact_lock(
    hashtextextended($recipe_id::text, 0)
);
```

All code paths that mutate graph structure must acquire the same recipe-specific lock before validating the graph.

This allows different recipes to be edited concurrently while serializing structural changes to the same recipe.

The lock is automatically released when the transaction completes.

---

# 15. Graph Mutation Boundary

Graph tables should not be mutated independently by arbitrary application code.

Introduce a domain/service boundary such as:

```text
RecipeGraphService
```

with operations resembling:

```text
createFoodState(...)
updateFoodState(...)
deleteFoodState(...)

createOperation(...)
updateOperation(...)
deleteOperation(...)

setOperationInputs(...)
setOperationOutputs(...)

addOperationInput(...)
removeOperationInput(...)

addOperationOutput(...)
removeOperationOutput(...)
```

Operations that modify graph topology must:

```text
BEGIN
  acquire recipe lock
  perform mutations
  validate invariants
COMMIT
```

Do not expose a generic abstraction such as:

```text
createEdge(source, target)
```

to the rest of the application.

The bipartite semantics are useful domain constraints and should remain explicit.

Prefer:

```text
addOperationInput(operationId, foodStateId)
```

over:

```text
addEdge(foodStateId, operationId)
```

---

# 16. Atomic Operation Creation

An operation should normally be created with its inputs and outputs in one transaction.

For example:

```text
createOperation({
    recipeId,
    type: "combine",
    inputs: [
        choppedCarrots,
        oliveOil,
        salt,
        pepper,
    ],
    outputs: [
        seasonedCarrots,
    ],
})
```

rather than requiring callers to construct temporarily invalid graph fragments.

Internally:

```text
BEGIN

create operation
create input relationships
create output relationships

validate graph

COMMIT
```

This also makes the invariant:

```text
operation has >= 1 input
operation has >= 1 output
```

much easier to maintain.

---

# 17. Example: Roasted Carrots

Consider the following process.

Ingredients:

```text
raw carrots
salt
pepper
olive oil
```

Process:

```text
raw carrots
    |
  [peel]
    |
peeled carrots
    |
  [chop]
    |
chopped carrots -------+
salt ------------------+
pepper ----------------+--> [combine]
olive oil -------------+
                              |
                              v
                 seasoned carrots on sheet pan
                              |
                           [roast]
                              |
                              v
                       roasted carrots
```

The relevant rows conceptually look like:

## Food states

```text
raw_carrots
peeled_carrots
chopped_carrots
salt
pepper
olive_oil
seasoned_carrots
roasted_carrots
```

## Operations

```text
peel_carrots
chop_carrots
season_carrots
roast_carrots
```

## Inputs

```text
peel_carrots:
    raw_carrots

chop_carrots:
    peeled_carrots

season_carrots:
    chopped_carrots
    salt
    pepper
    olive_oil

roast_carrots:
    seasoned_carrots
```

## Outputs

```text
peel_carrots:
    peeled_carrots

chop_carrots:
    chopped_carrots

season_carrots:
    seasoned_carrots

roast_carrots:
    roasted_carrots
```

The induced food-state dependencies are:

```text
raw_carrots -> peeled_carrots

peeled_carrots -> chopped_carrots

chopped_carrots -> seasoned_carrots
salt            -> seasoned_carrots
pepper          -> seasoned_carrots
olive_oil       -> seasoned_carrots

seasoned_carrots -> roasted_carrots
```

This induced graph is a DAG.

---

# 18. Fan-out and Dividing Food

A `FoodState` may technically be an input to multiple operations:

```text
          +--> operation A
FoodState |
          +--> operation B
```

The graph schema allows this.

However, cooking involves physical quantities. Using the same food in two consuming operations may accidentally imply duplication.

For example:

```text
2 lb dough
   |
   +--> pizza A
   |
   +--> pizza B
```

should often instead be modeled explicitly:

```text
2 lb dough
    |
 [divide]
   /   \
  v     v
1 lb   1 lb
dough  dough
 |      |
 v      v
pizza A pizza B
```

The initial graph layer should not attempt to enforce mass conservation.

Instead:

- graph topology describes dependency,
- quantities describe recipe intent,
- authors should use explicit divide/split operations when physical portions diverge.

A future semantic-validation layer can detect suspicious quantity usage.

---

# 19. Operation Configuration

Operation types have different properties.

For example:

```text
ROAST
    temperature
    duration
    oven mode

CHOP
    cut size

REST
    duration
    covered/uncovered

BOIL
    duration
    boil intensity
```

Do not create nullable columns for every possible operation property.

Instead use:

```text
operations.config JSONB
```

for operation-specific configuration.

Examples:

```json
{
  "temperature_f": 425,
  "convection": false
}
```

and:

```json
{
  "cut": "1/2-inch pieces"
}
```

The application should define schemas for each operation type.

Conceptually:

```text
OperationType -> config schema
```

For example:

```typescript
type RoastConfig = {
  temperatureF: number;
  convection?: boolean;
};
```

JSONB is a persistence mechanism for polymorphic configuration, not a substitute for application-level type validation.

---

# 20. Instructions vs Structured Data

Human-readable instructions and structured operation configuration serve different purposes.

For example:

```text
instructions:
"Roast until browned around the edges and tender."
```

while:

```json
{
  "temperature_f": 425,
  "duration_minutes": 25
}
```

contains machine-readable data.

Do not attempt to derive all UI text from structured configuration.

Likewise, do not store information needed for scheduling or computation only inside prose.

---

# 21. Graph Traversal

The schema should efficiently support both directions.

## Forward

Given:

```text
chopped carrots
```

find:

```text
operations consuming chopped carrots
outputs of those operations
their downstream operations
...
```

The index on:

```text
operation_inputs(recipe_id, food_state_id)
```

supports this traversal.

## Backward

Given:

```text
roasted carrots
```

find:

```text
operation that produced roasted carrots
inputs to that operation
operations that produced those inputs
...
```

The uniqueness/indexing around `operation_outputs` supports this direction.

Recursive traversal can use PostgreSQL recursive CTEs when useful.

For application workflows that already load the complete graph, traversal can instead happen in memory.

Recipe graphs are expected to be small enough that loading the complete topology will often be simpler than repeatedly querying individual graph levels.

---

# 22. Topological Ordering

A topological ordering is useful for:

- recipe rendering,
- dependency analysis,
- execution planning,
- scheduling,
- validation.

For example:

```text
raw carrots
salt
pepper
oil
peeled carrots
chopped carrots
seasoned carrots
roasted carrots
```

Food-state ordering alone does not necessarily represent the ideal user-facing recipe order, but topological sorting establishes a valid dependency order.

The application should not persist a global topological index as authoritative state.

It should be derived from graph topology.

If ordering eventually becomes performance-sensitive, a cached/materialized ordering can be added.

---

# 23. Execution Model

The recipe graph describes **what can happen**, not what is currently happening.

Do not put execution fields on the definition tables such as:

```text
food_states.available
operations.started_at
operations.completed_at
operations.status
```

Runtime execution should eventually use separate entities.

Conceptually:

```text
Recipe
   |
RecipeRun
   |
   +-- OperationRun
   |
   +-- FoodStateAvailability
```

For example:

```text
Operation
    id: roast_carrots

OperationRun
    operation_id: roast_carrots
    status: running
    started_at: ...
```

This allows one recipe definition to be executed many times.

---

# 24. Runnable Operations

Once execution support exists, an operation is runnable when all of its required input states are available.

Conceptually:

```text
inputs(operation) ⊆ availableFoodStates
```

Example:

```text
available:
    chopped carrots
    salt
    pepper
    oil
```

means:

```text
combine
```

is runnable.

After it completes:

```text
seasoned carrots
```

becomes available, potentially making:

```text
roast
```

runnable.

This is another reason the bipartite model is preferable to treating actions as edge labels.

---

# 25. Equipment

Equipment should not initially be represented as `FoodState` nodes.

For example:

```text
oven
sheet pan
knife
mixing bowl
```

are resources rather than food transformations.

The phrase:

```text
carrots on sheet pan
```

may still be a legitimate `FoodState`, because it describes the state of the food.

However, requiring:

```text
oven
```

to perform:

```text
roast
```

should eventually be represented separately.

Conceptually:

```text
Operation
   |
   +-- EquipmentRequirement
```

Equipment scheduling can then be added without changing the food dependency graph.

---

# 26. Canonical Ingredients

A future version may want to understand that:

```text
raw carrots
peeled carrots
chopped carrots
roasted carrots
```

all ultimately involve:

```text
carrot
```

This should be introduced as a separate concept rather than replacing `FoodState`.

For example:

```text
ingredient_definitions
----------------------
id
name
```

and:

```text
food_state_components
---------------------
food_state_id
ingredient_definition_id
```

This would support:

- grocery lists,
- ingredient search,
- nutrition,
- substitutions,
- semantic matching.

It is intentionally excluded from the initial graph schema.

---

# 27. Alternative Paths

The initial graph assumes one deterministic recipe process.

For example:

```text
chopped onions
      |
    saute
      |
sauteed onions
```

It does not initially support:

```text
             +--> saute --+
chopped onion             +--> cooked onion
             +--> roast --+
```

because a single `FoodState` is limited to one producer.

Supporting alternative methods introduces choice semantics rather than simple dependency semantics.

Potential future concepts include:

```text
OperationChoice
RecipeVariant
AlternativePath
```

These should be designed explicitly rather than weakening the one-producer invariant.

---

# 28. Deletion Semantics

Deleting a recipe should cascade through its entire graph.

Deleting an operation should delete its input and output relationships but should **not automatically delete its food states**.

Deleting a food state should cascade its input/output relationships.

After destructive graph mutations, normal graph validation should still run.

The application may later implement higher-level convenience behavior such as:

```text
deleteOperationAndOrphanedFoodStates(...)
```

but this should be explicit rather than hidden in database cascades.

---

# 29. Repository / Data-Access Layer

Persistence code should expose graph-specific concepts.

Suggested separation:

```text
RecipeRepository
FoodStateRepository
OperationRepository
RecipeGraphRepository
RecipeGraphService
```

The exact split may depend on the existing application architecture.

The important boundary is:

```text
ordinary CRUD
```

versus:

```text
topology mutation
```

Topology mutations must go through code responsible for graph invariants.

Repositories should not contain domain rules such as cycle detection unless the project intentionally places domain logic there.

A reasonable direction is:

```text
RecipeGraphService
    |
    +-- transaction management
    +-- recipe graph locking
    +-- topology mutation
    +-- invariant validation

RecipeGraphRepository
    |
    +-- SQL/data access
```

---

# 30. Loading a Recipe Graph

Provide one repository operation that loads the complete graph.

Conceptually:

```typescript
type RecipeGraph = {
  recipe: Recipe;
  foodStates: FoodState[];
  operations: Operation[];
  inputs: OperationInput[];
  outputs: OperationOutput[];
};
```

For normal recipe sizes, loading these four collections is preferable to implementing a generic lazy graph abstraction.

The domain layer can construct maps such as:

```typescript
foodStatesById;
operationsById;
inputsByOperationId;
outputsByOperationId;
consumersByFoodStateId;
producerByFoodStateId;
```

These indexes make traversal and validation straightforward.

---

# 31. Recommended Domain Types

Conceptually:

```typescript
type FoodState = {
  id: string;
  recipeId: string;
  name: string;
  description: string | null;
};

type Operation = {
  id: string;
  recipeId: string;
  type: string;
  name: string | null;
  instructions: string | null;
  estimatedDurationSeconds: number | null;
  config: unknown;
};

type OperationInput = {
  operationId: string;
  foodStateId: string;
  quantity: number | null;
  unit: string | null;
  position: number;
};

type OperationOutput = {
  operationId: string;
  foodStateId: string;
  quantity: number | null;
  unit: string | null;
  position: number;
};
```

These are illustrative domain shapes rather than mandated implementation syntax.

---

# 32. Graph Validation Interface

Graph validation should be independently testable.

Conceptually:

```typescript
validateRecipeGraph(graph);
```

returning:

```typescript
type GraphValidationResult =
  | {
      valid: true;
    }
  | {
      valid: false;
      errors: GraphValidationError[];
    };
```

Possible errors include:

```text
CYCLE_DETECTED
OPERATION_HAS_NO_INPUTS
OPERATION_HAS_NO_OUTPUTS
MULTIPLE_PRODUCERS
CROSS_RECIPE_CONNECTION
MISSING_FOOD_STATE
MISSING_OPERATION
```

Database constraints should still enforce invariants that are naturally relational.

Application validation should not replace database constraints unnecessarily.

---

# 33. Testing Requirements

The implementation should include tests covering at least the following graph shapes.

## Linear

```text
A -> op1 -> B -> op2 -> C
```

Expected: valid.

## Many-to-one

```text
A --+
B --+--> op1 --> D
C --+
```

Expected: valid.

## One-to-many

```text
          +--> B
A -> op1 -+
          +--> C
```

Expected: valid.

## Diamond

```text
       -> op1 -> B ->
A ----               op3 -> D
       -> op2 -> C ->
```

Expected: valid.

## Direct cycle

```text
A -> op1 -> A
```

Expected: invalid.

## Indirect cycle

```text
A -> op1 -> B
B -> op2 -> C
C -> op3 -> A
```

Expected: invalid.

## Multiple producers

```text
A -> op1 --+
           +--> C
B -> op2 --+
```

Expected: invalid.

## Cross-recipe relationship

```text
recipe A food state
        |
        v
recipe B operation
```

Expected: rejected by PostgreSQL foreign-key constraints.

---

# 34. Implementation Priorities

The initial implementation should focus on:

1. migrations for the four core graph entities,
2. persistence models,
3. complete recipe-graph loading,
4. graph traversal utilities,
5. cycle detection,
6. graph validation,
7. transactional topology mutation,
8. per-recipe mutation locking,
9. tests for graph invariants.

Do not implement speculative features from the future-work sections while building the initial graph layer.

---

# 35. Core Design Decisions

The following decisions should be treated as intentional architecture rather than incidental implementation details.

### Operations are nodes

Do:

```text
FoodState -> Operation -> FoodState
```

Do not model actions as labels on `FoodState -> FoodState` edges.

### Food states are recipe-local

`chopped carrot` is initially a state in a particular recipe, not a globally normalized ingredient entity.

### Each food state has at most one producer

This keeps dependency semantics deterministic.

### Root and terminal status are derived

Do not persist `is_root`, `is_terminal`, or equivalent flags.

### Graph topology and execution state are separate

A recipe definition must remain reusable across multiple cooking sessions.

### Operation-specific data uses typed application schemas backed by JSONB

Do not add dozens of nullable operation-specific database columns.

### Graph mutations are transactional

A topology mutation either results in a fully valid DAG or does not commit.

### Structural changes to one recipe are serialized

Use recipe-scoped transactional locking so concurrent graph mutations cannot jointly violate the DAG invariant.

### Prefer explicit domain operations over generic graph APIs

The system models cooking, not arbitrary graphs. Preserve cooking terminology in the application interface.

---

# 36. Future Extensions

The model should permit adding the following without restructuring the core graph:

```text
IngredientDefinition
FoodStateComponent

Equipment
EquipmentRequirement

RecipeVersion

RecipeRun
OperationRun

UnitDefinition
UnitConversion

RecipeVariant
OperationChoice

NutritionalInformation

IngredientSubstitution

Graph scheduling / critical path calculation

Parallel operation recommendations

Natural-language recipe import
```

The core:

```text
FoodState -> Operation -> FoodState
```

should remain stable as these capabilities are added.

---

# 37. Summary

A recipe is a recipe-scoped bipartite DAG consisting of:

```text
FoodState
Operation
OperationInput
OperationOutput
```

The fundamental relationship is:

```text
FoodState -> Operation -> FoodState
```

Operations are first-class graph nodes because cooking transformations may have multiple inputs, multiple outputs, configuration, duration, instructions, and eventual runtime state.

PostgreSQL should enforce relational invariants such as:

- referential integrity,
- recipe ownership,
- unique relationships,
- one producer per food state.

The application graph service should enforce graph-wide invariants such as:

- every operation having inputs and outputs,
- acyclicity.

Structural changes occur transactionally under a recipe-scoped lock.

This provides a relatively small initial schema while preserving a path toward execution scheduling, ingredient modeling, equipment constraints, recipe variants, and other more advanced cooking features.
