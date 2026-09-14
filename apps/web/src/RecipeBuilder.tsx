import { useCallback, useRef, useState } from "react";
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
import { Link } from "react-router-dom";

type RecipeNodeData = {
  label: string;
};

type FoodStateNode = Node<RecipeNodeData, "foodState">;
type OperationNode = Node<RecipeNodeData, "operation">;
type RecipeNode = FoodStateNode | OperationNode;
type RecipeEdge = Edge<Record<string, never>, "smoothstep">;
type NodeType = RecipeNode["type"];

type RecipeNodeOptions = {
  id: string;
  type: NodeType;
  position: RecipeNode["position"];
  label?: string;
  origin?: NonNullable<RecipeNode["origin"]>;
};

type RecipeEdgeEndpoints = Pick<Connection, "source" | "target"> &
  Partial<Pick<Connection, "sourceHandle" | "targetHandle">>;

function createRecipeNode({
  id,
  type,
  position,
  label,
  origin,
}: RecipeNodeOptions): RecipeNode {
  const node = {
    id,
    position,
    data: {
      label: label ?? (type === "foodState" ? "New ingredient" : "New step"),
    },
    ...(origin ? { origin } : {}),
  };

  return type === "foodState"
    ? ({ ...node, type } satisfies FoodStateNode)
    : ({ ...node, type } satisfies OperationNode);
}

function createRecipeEdge(endpoints: RecipeEdgeEndpoints): RecipeEdge {
  return {
    id: `${endpoints.source}-${endpoints.target}`,
    ...endpoints,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
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

const initialNodes: RecipeNode[] = [
  createRecipeNode({
    id: "food-state-1",
    type: "foodState",
    position: { x: 40, y: 120 },
    label: "Raw ingredient",
  }),
  createRecipeNode({
    id: "operation-1",
    type: "operation",
    position: { x: 340, y: 120 },
    label: "Prepare",
  }),
  createRecipeNode({
    id: "food-state-2",
    type: "foodState",
    position: { x: 640, y: 120 },
    label: "Prepared ingredient",
  }),
];

const initialEdges: RecipeEdge[] = [
  createRecipeEdge({
    source: "food-state-1",
    target: "operation-1",
  }),
  createRecipeEdge({
    source: "operation-1",
    target: "food-state-2",
  }),
];

const nodeTypes = {
  foodState: FoodStateCard,
  operation: OperationCard,
};

export function RecipeBuilderPage() {
  return (
    <ReactFlowProvider>
      <RecipeBuilder />
    </ReactFlowProvider>
  );
}

function RecipeBuilder() {
  const [recipeName, setRecipeName] = useState("Untitled recipe");
  const [nodes, setNodes, onNodesChange] =
    useNodesState<RecipeNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] =
    useEdgesState<RecipeEdge>(initialEdges);
  const canvasRef = useRef<HTMLDivElement>(null);
  const addedNodeCount = useRef(0);
  const { screenToFlowPosition, ...rest } = useReactFlow<
    RecipeNode,
    RecipeEdge
  >();

  const isValidConnection = useCallback<IsValidConnection<RecipeEdge>>(
    (connection) => isRecipeConnectionValid(connection, nodes, edges),
    [edges, nodes],
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
      const node = createRecipeNode({
        id,
        type,
        position,
        origin: [0, 0.5],
      });

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
        <p className="draft-status">Local draft · not saved</p>
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

      <div className="recipe-canvas" ref={canvasRef}>
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
      </div>
    </section>
  );
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
  const { deleteElements, updateNodeData } = useReactFlow<
    RecipeNode,
    RecipeEdge
  >();
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
        onChange={(event) => updateNodeData(id, { label: event.target.value })}
      />
      <p>{isFoodState ? "Food state" : "Operation"}</p>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
