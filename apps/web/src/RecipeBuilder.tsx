import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  validateRecipeDocument,
  type RecipeDocument,
  type RecipeIngestionWarning,
  type SavedRecipeDocument,
} from "@en-place/contracts";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  getOutgoers,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type OnConnectEnd,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  createRecipe,
  getRecipe,
  previewRecipeImport,
  updateRecipe,
} from "./api";

type RecipeNodeData = {
  label: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
  name?: string | null;
  instructions?: string | null;
  estimatedDurationSeconds?: number | null;
  config?: Record<string, unknown>;
};

type FoodStateNode = Node<RecipeNodeData, "foodState">;
type OperationNode = Node<RecipeNodeData, "operation">;
type RecipeNode = FoodStateNode | OperationNode;
type RecipeConnection = RecipeDocument["operations"][number]["inputs"][number];
type RecipeEdge = Edge<
  Pick<RecipeConnection, "quantity" | "unit" | "metadata">,
  "smoothstep"
>;
type NodeType = RecipeNode["type"];

type RecipeNodeOptions = {
  id: string;
  type: NodeType;
  position: RecipeNode["position"];
  label?: string;
  details?: Omit<RecipeNodeData, "label">;
};

type RecipeEdgeEndpoints = Pick<Connection, "source" | "target"> &
  Partial<Pick<Connection, "sourceHandle" | "targetHandle">>;

const recipeNodeOrigin: NonNullable<RecipeNode["origin"]> = [0, 0.5];

function createRecipeNode({
  id,
  type,
  position,
  label,
  details,
}: RecipeNodeOptions): RecipeNode {
  const node = {
    id,
    position,
    origin: recipeNodeOrigin,
    data: {
      label: label ?? (type === "foodState" ? "New ingredient" : "New step"),
      ...details,
    },
  };

  return type === "foodState"
    ? ({ ...node, type } satisfies FoodStateNode)
    : ({ ...node, type } satisfies OperationNode);
}

function createRecipeEdge(
  endpoints: RecipeEdgeEndpoints,
  connection?: Omit<RecipeConnection, "foodStateId">,
): RecipeEdge {
  return {
    id: `${endpoints.source}-${endpoints.target}`,
    ...endpoints,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
    data: connection ?? { quantity: null, unit: null, metadata: {} },
  };
}

function wouldCreateCycle(
  source: RecipeNode,
  target: RecipeNode,
  nodes: RecipeNode[],
  edges: RecipeEdge[],
) {
  const visited = new Set<string>();
  const pending = [target];

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || visited.has(node.id)) {
      continue;
    }
    if (node.id === source.id) {
      return true;
    }

    visited.add(node.id);
    pending.push(...getOutgoers(node, nodes, edges));
  }

  return false;
}

function isRecipeConnectionValid(
  connection: RecipeEdge | Connection,
  nodes: RecipeNode[],
  edges: RecipeEdge[],
) {
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);

  if (!source || !target || source.type === target.type) {
    return false;
  }

  if (
    target.type === "foodState" &&
    edges.some((edge) => edge.target === target.id)
  ) {
    return false;
  }

  return !wouldCreateCycle(source, target, nodes, edges);
}

function createInitialGraph(): { nodes: RecipeNode[]; edges: RecipeEdge[] } {
  const inputId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const outputId = crypto.randomUUID();
  const nodes: RecipeNode[] = [
    createRecipeNode({
      id: inputId,
      type: "foodState",
      position: { x: 40, y: 120 },
      label: "Raw ingredient",
    }),
    createRecipeNode({
      id: operationId,
      type: "operation",
      position: { x: 340, y: 120 },
      label: "Prepare",
    }),
    createRecipeNode({
      id: outputId,
      type: "foodState",
      position: { x: 640, y: 120 },
      label: "Prepared ingredient",
    }),
  ];

  return {
    nodes,
    edges: [
      createRecipeEdge({ source: inputId, target: operationId }),
      createRecipeEdge({ source: operationId, target: outputId }),
    ],
  };
}

const nodeTypes = {
  foodState: FoodStateCard,
  operation: OperationCard,
};

const RecipeNodeLabelContext = createContext<
  ((nodeId: string, label: string) => void) | null
>(null);

export function RecipeBuilderPage() {
  const { recipeId } = useParams<{ recipeId: string }>();

  return (
    <ReactFlowProvider>
      {recipeId ?
        <RecipeBuilder key={recipeId} recipeId={recipeId} />
      : <RecipeBuilder key="new" />}
    </ReactFlowProvider>
  );
}

function RecipeBuilder({ recipeId }: { recipeId?: string }) {
  const initialGraph = useRef(
    recipeId ? { nodes: [] as RecipeNode[], edges: [] as RecipeEdge[] }
    : createInitialGraph(),
  ).current;
  const [recipeName, setRecipeName] = useState("Untitled recipe");
  const [recipeDescription, setRecipeDescription] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] =
    useNodesState<RecipeNode>(initialGraph.nodes);
  const [ingredientsText, setIngredientsText] = useState("");
  const [instructionsText, setInstructionsText] = useState("");
  const [ingestionWarnings, setIngestionWarnings] = useState<
    RecipeIngestionWarning[]
  >([]);
  const [edges, setEdges, onEdgesChange] =
    useEdgesState<RecipeEdge>(initialGraph.edges);
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null);
  const [hydratedRecipeId, setHydratedRecipeId] = useState<string | null>(
    recipeId ? null : "new",
  );
  const canvasRef = useRef<HTMLDivElement>(null);
  const addedNodeCount = useRef(0);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { screenToFlowPosition } = useReactFlow<RecipeNode, RecipeEdge>();
  const loadedRecipe = useQuery({
    queryKey: ["recipe", recipeId],
    queryFn: () => getRecipe(recipeId!),
    enabled: recipeId !== undefined,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    if (
      !recipeId ||
      !loadedRecipe.data ||
      hydratedRecipeId === recipeId
    ) {
      return;
    }

    const flowGraph = toFlowGraph(loadedRecipe.data);
    setRecipeName(loadedRecipe.data.name);
    setRecipeDescription(loadedRecipe.data.description);
    setNodes(flowGraph.nodes);
    setEdges(flowGraph.edges);
    setSavedFingerprint(documentFingerprint(toRecipeDocument(loadedRecipe.data)));
    setHydratedRecipeId(recipeId);
  }, [
    hydratedRecipeId,
    loadedRecipe.data,
    recipeId,
    setEdges,
    setNodes,
  ]);

  const document = useMemo(
    () => buildRecipeDocument(recipeName, recipeDescription, nodes, edges),
    [edges, nodes, recipeDescription, recipeName],
  );
  const validation = useMemo(
    () => validateRecipeDocument(document),
    [document],
  );
  const currentFingerprint = documentFingerprint(
    validation.valid ? validation.document : document,
  );
  const isDirty = currentFingerprint !== savedFingerprint;
  const saveRecipe = useMutation({
    mutationFn: (input: RecipeDocument) =>
      recipeId ? updateRecipe(recipeId, input) : createRecipe(input),
    onSuccess: (savedRecipe) => {
      const savedDocument = toRecipeDocument(savedRecipe);
      const flowGraph = toFlowGraph(savedRecipe);
      queryClient.setQueryData(["recipe", savedRecipe.id], savedRecipe);
      setRecipeName(savedRecipe.name);
      setRecipeDescription(savedRecipe.description);
      setNodes(flowGraph.nodes);
      setEdges(flowGraph.edges);
      setSavedFingerprint(documentFingerprint(savedDocument));
      if (!recipeId) {
        navigate(`/recipes/${savedRecipe.id}`, { replace: true });
      }
    },
  });
  const recipeImport = useMutation({
    mutationFn: () =>
      previewRecipeImport({
        name: recipeName,
        description: recipeDescription,
        ingredientsText,
        instructionsText,
      }),
    onSuccess: (preview) => {
      const flowGraph = toFlowGraph(preview.recipe);
      setNodes(flowGraph.nodes);
      setEdges(flowGraph.edges);
      setIngestionWarnings(preview.warnings);
    },
  });

  const isLoadingRecipe =
    recipeId !== undefined &&
    (loadedRecipe.isPending || hydratedRecipeId !== recipeId);
  const invalidReason =
    validation.valid ? undefined : validation.errors[0]?.message;
  const canSave =
    validation.valid &&
    isDirty &&
    !saveRecipe.isPending &&
    !isLoadingRecipe;
  const saveStatus =
    saveRecipe.isPending ? "Saving…"
    : saveRecipe.error ? saveRecipe.error.message
    : invalidReason ? invalidReason
    : !isDirty && recipeId ? "Saved"
    : "Ready to save";

  const isValidConnection = useCallback<IsValidConnection<RecipeEdge>>(
    (connection) => isRecipeConnectionValid(connection, nodes, edges),
    [edges, nodes],
  );

  const updateNodeLabel = useCallback(
    (nodeId: string, label: string) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, label } }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const connectNodes = useCallback(
    (connection: Connection) => {
      setEdges((currentEdges) =>
        addEdge(createRecipeEdge(connection), currentEdges),
      );
    },
    [setEdges],
  );

  const connectToNewNode = useCallback<OnConnectEnd>(
    (event, connectionState) => {
      if (
        connectionState.isValid ||
        !connectionState.fromNode ||
        connectionState.toNode
      ) {
        return;
      }

      const pointer =
        "changedTouches" in event ? event.changedTouches.item(0) : event;
      const source = nodes.find(
        (node) => node.id === connectionState.fromNode?.id,
      );

      if (
        !pointer ||
        !source ||
        (source.type !== "foodState" && source.type !== "operation")
      ) {
        return;
      }

      const id = crypto.randomUUID();
      const type = source.type === "foodState" ? "operation" : "foodState";
      const position = screenToFlowPosition({
        x: pointer.clientX,
        y: pointer.clientY,
      });
      const node = createRecipeNode({ id, type, position });

      setNodes((currentNodes) => [...currentNodes, node]);
      setEdges((currentEdges) =>
        addEdge(
          createRecipeEdge({
            source: source.id,
            target: id,
          }),
          currentEdges,
        ),
      );
    },
    [nodes, screenToFlowPosition, setEdges, setNodes],
  );

  function addNode(type: NodeType) {
    const bounds = canvasRef.current?.getBoundingClientRect();
    const slot = addedNodeCount.current++;
    const screenPosition = {
      x: bounds
        ? bounds.left + bounds.width / 2 - 360 + (slot % 3) * 360
        : window.innerWidth / 2,
      y: bounds
        ? bounds.top +
          bounds.height / 2 +
          150 +
          Math.floor((slot % 6) / 3) * 150
        : window.innerHeight / 2,
    };
    const position = screenToFlowPosition(screenPosition);
    const node = createRecipeNode({
      id: crypto.randomUUID(),
      type,
      position,
    });

    setNodes((currentNodes) => [...currentNodes, node]);
  }

  if (loadedRecipe.isError) {
    return (
      <section className="recipe-builder-message" aria-labelledby="recipe-load-title">
        <h1 id="recipe-load-title">Recipe unavailable</h1>
        <p>{loadedRecipe.error.message}</p>
        <Link className="back-link" to="/">Back to home</Link>
      </section>
    );
  }

  if (isLoadingRecipe) {
    return (
      <section className="recipe-builder-message" aria-live="polite">
        <div className="spinner" aria-hidden="true" />
        <p>Loading recipe…</p>
      </section>
    );
  }

  return (
    <section className="recipe-builder" aria-labelledby="recipe-builder-title">
      <header className="recipe-builder-header">
        <Link className="back-link" to="/">
          Back to home
        </Link>
        <label className="recipe-name-field" htmlFor="recipe-name">
          <span>Recipe name</span>
          <input
            id="recipe-name"
            value={recipeName}
            onChange={(event) => setRecipeName(event.target.value)}
            maxLength={200}
          />
        </label>
        <label className="recipe-name-field" htmlFor="recipe-description">
          <span>Description</span>
          <input
            id="recipe-description"
            value={recipeDescription ?? ""}
            onChange={(event) =>
              setRecipeDescription(
                event.target.value.trim() ? event.target.value : null,
              )
            }
            maxLength={5_000}
          />
        </label>
        <div className="recipe-save-controls">
          <p
            className={`draft-status${invalidReason ? " draft-status--invalid" : ""}`}
            aria-live="polite"
          >
            {saveStatus}
          </p>
          <button
            className="save-recipe-button"
            type="button"
            disabled={!canSave}
            title={invalidReason}
            onClick={() => {
              if (validation.valid) {
                saveRecipe.mutate(validation.document);
              }
            }}
          >
            {saveRecipe.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      <div className="recipe-builder-toolbar">
        <div>
          <h1 id="recipe-builder-title">Build your recipe</h1>
          <p>
            Connect ingredients to steps, then steps to results. Drop a
            connection on the canvas to create the next node automatically.
            Cycles and invalid links are blocked.
          </p>
        </div>
        <div className="node-actions" aria-label="Add recipe node">
          <button
            className="add-node-button add-node-button--food"
            type="button"
            onClick={() => addNode("foodState")}
          >
            <span aria-hidden="true">+</span> Ingredient
          </button>
          <button
            className="add-node-button add-node-button--operation"
            type="button"
            onClick={() => addNode("operation")}
          >
            <span aria-hidden="true">+</span> Step
          </button>
        </div>
      </div>
      <details className="recipe-import">
        <summary>Import a written recipe</summary>
        <div className="recipe-import__body">
          <label htmlFor="recipe-ingredients">
            Ingredients
            <textarea
              id="recipe-ingredients"
              value={ingredientsText}
              onChange={(event) => setIngredientsText(event.target.value)}
              maxLength={25_000}
              rows={6}
              placeholder="Paste the ingredient list here."
            />
          </label>
          <label htmlFor="recipe-instructions">
            Instructions
            <textarea
              id="recipe-instructions"
              value={instructionsText}
              onChange={(event) => setInstructionsText(event.target.value)}
              maxLength={25_000}
              rows={8}
              placeholder="Paste the recipe instructions here."
            />
          </label>
          {recipeImport.error && (
            <p className="form-error" role="alert">
              {recipeImport.error.message}
            </p>
          )}
          {ingestionWarnings.length > 0 && (
            <div className="recipe-import__warnings" role="status">
              <strong>Review these assumptions</strong>
              <ul>
                {ingestionWarnings.map((warning) => (
                  <li
                    key={[
                      warning.code,
                      warning.operationId,
                      warning.foodStateId,
                      warning.message,
                    ].join(":")}
                  >
                    {warning.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            className="primary-button"
            type="button"
            disabled={
              recipeName.trim().length === 0 ||
              ingredientsText.trim().length === 0 ||
              instructionsText.trim().length === 0 ||
              recipeImport.isPending
            }
            onClick={() => recipeImport.mutate()}
          >
            {recipeImport.isPending ? "Converting…" : "Create preview"}
          </button>
        </div>
      </details>

      <div className="recipe-canvas" ref={canvasRef}>
        <RecipeNodeLabelContext.Provider value={updateNodeLabel}>
          <ReactFlow<RecipeNode, RecipeEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={connectNodes}
            onConnectEnd={connectToNewNode}
            isValidConnection={isValidConnection}
            defaultEdgeOptions={{
              type: "smoothstep",
              markerEnd: { type: MarkerType.ArrowClosed },
            }}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            minZoom={0.35}
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1.4}
              color="#c9c8bb"
            />
            <Controls position="bottom-right" showInteractive={false} />
            <MiniMap
              position="bottom-left"
              nodeColor={(node) =>
                node.type === "operation" ? "#bc5b38" : "#55795b"
              }
              maskColor="rgb(244 241 232 / 70%)"
              pannable
              zoomable
            />
          </ReactFlow>
        </RecipeNodeLabelContext.Provider>
      </div>
    </section>
  );
}

function buildRecipeDocument(
  name: string,
  description: string | null,
  nodes: RecipeNode[],
  edges: RecipeEdge[],
): RecipeDocument {
  return {
    name,
    description,
    foodStates: nodes.filter(isFoodStateNode).map((node) => ({
      id: node.id,
      name: node.data.label,
      description: node.data.description ?? null,
      metadata: node.data.metadata ?? {},
      position: node.position,
    })),
    operations: nodes.filter(isOperationNode).map((node) => ({
      id: node.id,
      type: node.data.label,
      name: node.data.name ?? null,
      instructions: node.data.instructions ?? null,
      estimatedDurationSeconds: node.data.estimatedDurationSeconds ?? null,
      config: node.data.config ?? {},
      position: node.position,
      inputs: edges
        .filter((edge) => edge.target === node.id)
        .map((edge) => ({
          foodStateId: edge.source,
          ...recipeConnectionDetails(edge),
        })),
      outputs: edges
        .filter((edge) => edge.source === node.id)
        .map((edge) => ({
          foodStateId: edge.target,
          ...recipeConnectionDetails(edge),
        })),
    })),
  };
}

function toRecipeDocument(recipe: SavedRecipeDocument): RecipeDocument {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...document } =
    recipe;
  return document;
}

function toFlowGraph(
  recipe: RecipeDocument,
): { nodes: RecipeNode[]; edges: RecipeEdge[] } {
  return {
    nodes: [
      ...recipe.foodStates.map((foodState) =>
        createRecipeNode({
          id: foodState.id,
          type: "foodState",
          position: foodState.position,
          label: foodState.name,
          details: {
            description: foodState.description,
            metadata: foodState.metadata,
          },
        }),
      ),
      ...recipe.operations.map((operation) =>
        createRecipeNode({
          id: operation.id,
          type: "operation",
          position: operation.position,
          label: operation.type,
          details: {
            name: operation.name,
            instructions: operation.instructions,
            estimatedDurationSeconds: operation.estimatedDurationSeconds,
            config: operation.config,
          },
        }),
      ),
    ],
    edges: recipe.operations.flatMap((operation) => [
      ...operation.inputs.map(({ foodStateId, ...connection }) =>
        createRecipeEdge(
          { source: foodStateId, target: operation.id },
          connection,
        ),
      ),
      ...operation.outputs.map(({ foodStateId, ...connection }) =>
        createRecipeEdge(
          { source: operation.id, target: foodStateId },
          connection,
        ),
      ),
    ]),
  };
}

function recipeConnectionDetails(
  edge: RecipeEdge,
): Omit<RecipeConnection, "foodStateId"> {
  return edge.data ?? { quantity: null, unit: null, metadata: {} };
}

function documentFingerprint(document: RecipeDocument): string {
  return JSON.stringify(document);
}

function isFoodStateNode(node: RecipeNode): node is FoodStateNode {
  return node.type === "foodState";
}

function isOperationNode(node: RecipeNode): node is OperationNode {
  return node.type === "operation";
}

function FoodStateCard(props: NodeProps<FoodStateNode>) {
  return <RecipeNodeCard {...props} kind="foodState" />;
}

function OperationCard(props: NodeProps<OperationNode>) {
  return <RecipeNodeCard {...props} kind="operation" />;
}

type RecipeNodeCardProps = {
  id: string;
  data: RecipeNodeData;
  selected: boolean;
  kind: NodeType;
};

function RecipeNodeCard({ id, data, selected, kind }: RecipeNodeCardProps) {
  const { deleteElements } = useReactFlow<RecipeNode, RecipeEdge>();
  const updateNodeLabel = useContext(RecipeNodeLabelContext);
  if (!updateNodeLabel) {
    throw new Error("Recipe node cards require a label update provider");
  }
  const isFoodState = kind === "foodState";

  return (
    <div
      className={`recipe-node recipe-node--${kind}${selected ? " is-selected" : ""}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectableStart={false}
      />
      <div className="recipe-node-heading">
        <span>{isFoodState ? "Ingredient or result" : "Cooking step"}</span>
        <button
          className="recipe-node-delete nodrag nopan"
          type="button"
          aria-label={`Delete ${data.label || (isFoodState ? "ingredient" : "step")}`}
          title="Delete node"
          onClick={() => void deleteElements({ nodes: [{ id }] })}
        >
          ×
        </button>
      </div>
      <input
        className="recipe-node-input nodrag"
        value={data.label}
        aria-label={
          isFoodState ? "Ingredient or result name" : "Cooking step name"
        }
        placeholder={isFoodState ? "e.g. diced onions" : "e.g. sauté"}
        onChange={(event) => updateNodeLabel(id, event.target.value)}
      />
      <p>{isFoodState ? "Food state" : "Operation"}</p>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
