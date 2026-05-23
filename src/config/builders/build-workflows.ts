import { build as esbuildBuild, type Loader } from "esbuild";
import { existsSync, readdirSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import * as ts from "typescript";
import type { Context } from "@/context/Context";
import type { WorkflowBuildResult, WorkflowLayerTrace, WorkflowMeta } from "@/types/workflows";
import { isSafeWorkflowName, WORKFLOW_SIZE_LIMIT, workflowMetaSchema } from "@/config/workflow-schema";
import { getPluginWorkflows } from "@/plugins/registry";
import { SANDBOX_GLOBAL_NAMES } from "@/types/workflows";
import { resolveConfigDirectoryPath } from "@/utils/config-directory";
import { type ConfigLayer, formatConfigError } from "@/utils/errors";
import { log } from "@/utils/log";

interface ResolveContext {
  errorLayer: ConfigLayer;
  traceLayer: WorkflowLayerTrace["layer"];
  layerName?: string;
}

interface LoadedWorkflow {
  filename: string;
  content: string;
  sourcePath: string;
  trace: WorkflowLayerTrace;
}

interface ParsedWorkflowSource {
  meta: WorkflowMeta;
  definitionSource: string;
  schemaSource?: string;
  enabled: boolean;
}

interface ExtractedWorkflowMeta {
  meta: Record<string, unknown>;
  schemaExpression: string | undefined;
  enabled: boolean;
}

class WorkflowSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowSourceError";
  }
}

type SourceRange = readonly [start: number, end: number];
type SourceEdit = {
  range: SourceRange;
  replacement: string;
};

const CREATE_WORKFLOW_MODULE = "@/config/helpers";
const CREATE_WORKFLOW_NAME = "createWorkflow";
const BUNDLED_WORKFLOW_GLOBAL = "__cccWorkflowBundle";
const BUNDLED_SCHEMA_GLOBAL = "__cccWorkflowSchemaBundle";
const BUNDLED_DEFINITION_EXPORT = "__cccWorkflowDefinition";
const BUNDLED_SCHEMA_JSON_EXPORT = "__cccWorkflowArgsSchemaJson";
const TO_JSON_SCHEMA_IMPORT = "__cccToJSONSchema";
const HANDLER_PROPERTY = "handler";
const SCHEMA_PROPERTY = "schema";
const ENABLED_PROPERTY = "enabled";
const ARGS_SCHEMA_WHEN_TO_USE_HEADER = "Args schema (JSON Schema for Workflow({ args })):";
const REMOVED_WORKFLOW_KEYS: ReadonlySet<string> = new Set(["body", "scriptPath"]);
const RESERVED_LITERAL_META_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

const workflowByteLength = (content: string) => Buffer.byteLength(content, "utf8");

const createWorkflowTrace = (layer: WorkflowLayerTrace["layer"], layerName?: string): WorkflowLayerTrace => {
  return layerName ? { layer, name: layerName, mode: "override" } : { layer, mode: "override" };
};

const rejectOversizeWorkflow = (label: string, content: string) => {
  const bytes = workflowByteLength(content);
  if (bytes <= WORKFLOW_SIZE_LIMIT) return false;
  log.warn("WORKFLOWS", `Workflow ${label} is ${bytes} bytes and exceeds ${WORKFLOW_SIZE_LIMIT}; skipping.`);
  return true;
};

const getNodeRange = (source: string, node: ts.Node): SourceRange => {
  let end = node.getEnd();
  while (source[end] === " " || source[end] === "\t" || source[end] === ";") end += 1;
  if (source.slice(end, end + 2) === "\r\n") end += 2;
  else if (source[end] === "\n" || source[end] === "\r") end += 1;
  return [node.getStart(), end];
};

const applySourceEdits = (source: string, edits: SourceEdit[]) => {
  return edits
    .slice()
    .sort((a, b) => b.range[0] - a.range[0])
    .reduce(
      (result, edit) => result.slice(0, edit.range[0]) + edit.replacement + result.slice(edit.range[1]),
      source,
    )
    .trimStart();
};

const unwrapExpression = (expression: ts.Expression): ts.Expression => {
  if (ts.isParenthesizedExpression(expression)) return unwrapExpression(expression.expression);
  if (ts.isAsExpression(expression)) return unwrapExpression(expression.expression);
  if (ts.isSatisfiesExpression(expression)) return unwrapExpression(expression.expression);
  if (ts.isTypeAssertionExpression(expression)) return unwrapExpression(expression.expression);
  return expression;
};

const hasExportModifier = (node: ts.Node) => {
  return (
    ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
};

const propertyNameText = (name: ts.PropertyName) => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  throw new WorkflowSourceError("workflow metadata object keys must be literal property names");
};

const isObjectPropertyNamed = (property: ts.ObjectLiteralElementLike, expectedName: string) => {
  if (ts.isSpreadAssignment(property)) return false;
  if (ts.isShorthandPropertyAssignment(property)) return property.name.text === expectedName;
  if (!("name" in property)) return false;
  return propertyNameText(property.name) === expectedName;
};

const printNode = (node: ts.Node, sourceFile: ts.SourceFile) => {
  return ts.createPrinter({ removeComments: false }).printNode(ts.EmitHint.Expression, node, sourceFile);
};

const printStatement = (node: ts.Statement, sourceFile: ts.SourceFile) => {
  return ts.createPrinter({ removeComments: false }).printNode(ts.EmitHint.Unspecified, node, sourceFile);
};

const literalValueFromExpression = (rawExpression: ts.Expression): unknown => {
  const expression = unwrapExpression(rawExpression);

  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (expression.kind === ts.SyntaxKind.NullKeyword) return null;

  if (ts.isPrefixUnaryExpression(expression)) {
    const operand = literalValueFromExpression(expression.operand);
    if (typeof operand !== "number") {
      throw new WorkflowSourceError("workflow metadata unary values must be numeric literals");
    }
    if (expression.operator === ts.SyntaxKind.MinusToken) return -operand;
    if (expression.operator === ts.SyntaxKind.PlusToken) return operand;
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.map((element) => {
      if (ts.isSpreadElement(element)) {
        throw new WorkflowSourceError("workflow metadata arrays cannot use spread elements");
      }
      return literalValueFromExpression(element);
    });
  }

  if (ts.isObjectLiteralExpression(expression)) {
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property)) {
        throw new WorkflowSourceError("workflow metadata objects must contain property assignments only");
      }
      const key = propertyNameText(property.name);
      if (RESERVED_LITERAL_META_KEYS.has(key)) {
        throw new WorkflowSourceError(`workflow metadata key "${key}" is reserved`);
      }
      if (Object.hasOwn(result, key)) {
        throw new WorkflowSourceError(`workflow metadata duplicates key "${key}"`);
      }
      result[key] = literalValueFromExpression(property.initializer);
    }
    return result;
  }

  throw new WorkflowSourceError("workflow metadata must be a pure literal object");
};

const isCreateWorkflowImport = (statement: ts.Statement) => {
  if (!ts.isImportDeclaration(statement)) return false;
  if (!ts.isStringLiteral(statement.moduleSpecifier)) return false;
  if (statement.moduleSpecifier.text !== CREATE_WORKFLOW_MODULE) return false;

  const importClause = statement.importClause;
  if (!importClause || importClause.name || importClause.namedBindings === undefined) return false;
  if (!ts.isNamedImports(importClause.namedBindings)) return false;

  const elements = importClause.namedBindings.elements;
  return elements.length === 1 && elements[0]?.name.text === CREATE_WORKFLOW_NAME;
};

const getDefaultCreateWorkflowExport = (sourceFile: ts.SourceFile) => {
  const defaultExports = sourceFile.statements.filter(
    (statement): statement is ts.ExportAssignment =>
      ts.isExportAssignment(statement) && !statement.isExportEquals,
  );
  if (defaultExports.length !== 1) {
    throw new WorkflowSourceError("workflow source must contain exactly one default createWorkflow export");
  }

  const defaultExport = defaultExports[0]!;
  for (const statement of sourceFile.statements) {
    if (statement === defaultExport) continue;
    if (
      ts.isExportDeclaration(statement) ||
      ts.isExportAssignment(statement) ||
      hasExportModifier(statement)
    ) {
      throw new WorkflowSourceError("workflow source cannot export anything except default createWorkflow");
    }
  }

  return defaultExport;
};

const getCreateWorkflowObject = (statement: ts.ExportAssignment) => {
  const expression = unwrapExpression(statement.expression);
  if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)) {
    throw new WorkflowSourceError("workflow default export must call createWorkflow");
  }
  if (expression.expression.text !== CREATE_WORKFLOW_NAME || expression.arguments.length !== 1) {
    throw new WorkflowSourceError("workflow default export must call createWorkflow with one object");
  }

  const argument = unwrapExpression(expression.arguments[0]!);
  if (!ts.isObjectLiteralExpression(argument)) {
    throw new WorkflowSourceError("createWorkflow must receive a static object literal");
  }
  return argument;
};

const getSchemaExpressionText = (property: ts.ObjectLiteralElementLike, sourceFile: ts.SourceFile) => {
  if (ts.isPropertyAssignment(property)) return property.initializer.getText(sourceFile);
  if (ts.isShorthandPropertyAssignment(property)) return property.name.getText(sourceFile);
  throw new WorkflowSourceError("createWorkflow schema must be a property assignment");
};

const BUILD_TIME_ONLY_PROPERTIES: ReadonlySet<string> = new Set([SCHEMA_PROPERTY, ENABLED_PROPERTY]);

const definitionWithoutBuildTimeProps = (
  definition: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
) => {
  const properties = definition.properties.filter(
    (property) => ![...BUILD_TIME_ONLY_PROPERTIES].some((name) => isObjectPropertyNamed(property, name)),
  );
  const stripped = ts.factory.updateObjectLiteralExpression(definition, properties);
  return printNode(stripped, sourceFile);
};

const collectBindingNames = (name: ts.BindingName, names: Set<string>) => {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    collectBindingNames(element.name, names);
  }
};

const declaredTopLevelNames = (statement: ts.Statement) => {
  const names = new Set<string>();

  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (!clause) return names;
    if (clause.name) names.add(clause.name.text);
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      names.add(clause.namedBindings.name.text);
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) names.add(element.name.text);
    }
    return names;
  }

  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      collectBindingNames(declaration.name, names);
    }
    return names;
  }

  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement)) &&
    statement.name
  ) {
    names.add(statement.name.text);
  }

  return names;
};

const declaredVariableNames = (declaration: ts.VariableDeclaration) => {
  const names = new Set<string>();
  collectBindingNames(declaration.name, names);
  return names;
};

const isIdentifierReference = (node: ts.Identifier) => {
  const parent = node.parent;
  if (!parent) return true;

  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false;
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.name === node) return false;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return false;
  if (ts.isClassDeclaration(parent) && parent.name === node) return false;
  if (ts.isEnumDeclaration(parent) && parent.name === node) return false;
  if (ts.isInterfaceDeclaration(parent) && parent.name === node) return false;
  if (ts.isTypeAliasDeclaration(parent) && parent.name === node) return false;
  if (ts.isImportClause(parent) && parent.name === node) return false;
  if (ts.isImportSpecifier(parent) && parent.name === node) return false;
  if (ts.isNamespaceImport(parent) && parent.name === node) return false;
  return true;
};

const collectReferencedIdentifiers = (node: ts.Node) => {
  const names = new Set<string>();

  const visit = (current: ts.Node) => {
    if (ts.isImportDeclaration(current)) return;
    if (ts.isTypeNode(current)) return;
    if (ts.isIdentifier(current) && isIdentifierReference(current)) names.add(current.text);
    ts.forEachChild(current, visit);
  };

  visit(node);
  return names;
};

const collectReferencedIdentifiersFromExpressionText = (expressionText: string, sourcePath: string) => {
  const sourceFile = ts.createSourceFile(
    `${sourcePath}.expression.ts`,
    `const __cccExpression = ${expressionText};`,
    ts.ScriptTarget.Latest,
    true,
  );
  return collectReferencedIdentifiers(sourceFile);
};

const collectReferencesForKnownTopLevelNames = (statement: ts.Statement, knownNames: Set<string>) => {
  const declaredNames = declaredTopLevelNames(statement);
  if (![...declaredNames].some((name) => knownNames.has(name))) return new Set<string>();

  if (!ts.isVariableStatement(statement)) return collectReferencedIdentifiers(statement);

  const references = new Set<string>();
  for (const declaration of statement.declarationList.declarations) {
    const declarationNames = declaredVariableNames(declaration);
    if (![...declarationNames].some((name) => knownNames.has(name))) continue;
    for (const name of collectReferencedIdentifiers(declaration)) references.add(name);
  }
  return references;
};

const collectTransitiveTopLevelNames = (sourceFile: ts.SourceFile, initialNames: Set<string>) => {
  const names = new Set(initialNames);
  let changed = true;

  while (changed) {
    changed = false;
    for (const statement of sourceFile.statements) {
      for (const name of collectReferencesForKnownTopLevelNames(statement, names)) {
        if (names.has(name)) continue;
        names.add(name);
        changed = true;
      }
    }
  }

  return names;
};

const createSchemaOnlySourceEdits = (
  source: string,
  sourceFile: ts.SourceFile,
  schemaExpression: string,
  definitionText: string,
) => {
  const schemaOnlyNames = collectTransitiveTopLevelNames(
    sourceFile,
    collectReferencedIdentifiersFromExpressionText(schemaExpression, sourceFile.fileName),
  );
  const liveNames = collectTransitiveTopLevelNames(
    sourceFile,
    collectReferencedIdentifiersFromExpressionText(definitionText, sourceFile.fileName),
  );
  const edits: SourceEdit[] = [];

  for (const statement of sourceFile.statements) {
    const declaredNames = declaredTopLevelNames(statement);
    if (declaredNames.size === 0) continue;

    if (ts.isVariableStatement(statement)) {
      const keptDeclarations = statement.declarationList.declarations.filter((declaration) => {
        const declarationNames = declaredVariableNames(declaration);
        const isSchemaOnly = [...declarationNames].some((name) => schemaOnlyNames.has(name));
        const isLive = [...declarationNames].some((name) => liveNames.has(name));
        return !isSchemaOnly || isLive;
      });
      if (keptDeclarations.length === statement.declarationList.declarations.length) continue;
      const range = getNodeRange(source, statement);
      if (keptDeclarations.length === 0) {
        edits.push({ range, replacement: "" });
        continue;
      }

      const declarationList = ts.factory.updateVariableDeclarationList(
        statement.declarationList,
        keptDeclarations,
      );
      const updatedStatement = ts.factory.updateVariableStatement(
        statement,
        ts.getModifiers(statement),
        declarationList,
      );
      edits.push({ range, replacement: `${printStatement(updatedStatement, sourceFile)}\n` });
      continue;
    }

    const isSchemaOnly = [...declaredNames].some((name) => schemaOnlyNames.has(name));
    const isLive = [...declaredNames].some((name) => liveNames.has(name));
    if (isSchemaOnly && !isLive) edits.push({ range: getNodeRange(source, statement), replacement: "" });
  }

  return edits;
};

const extractWorkflowMeta = (
  definition: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): ExtractedWorkflowMeta => {
  const meta: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  let hasHandler = false;
  let schemaExpression: string | undefined;
  let enabled = true;
  let sawEnabled = false;

  for (const property of definition.properties) {
    if (ts.isSpreadAssignment(property)) {
      throw new WorkflowSourceError("createWorkflow metadata cannot use spread properties");
    }

    if (ts.isMethodDeclaration(property)) {
      const key = propertyNameText(property.name);
      if (key !== HANDLER_PROPERTY) {
        throw new WorkflowSourceError("createWorkflow method properties are only allowed for handler");
      }
      if (hasHandler) throw new WorkflowSourceError("createWorkflow must define one handler");
      hasHandler = true;
      continue;
    }

    if (ts.isShorthandPropertyAssignment(property)) {
      const key = property.name.text;
      if (key !== SCHEMA_PROPERTY) {
        throw new WorkflowSourceError("createWorkflow properties must be literal assignments");
      }
      if (schemaExpression !== undefined) {
        throw new WorkflowSourceError("createWorkflow must define at most one schema");
      }
      schemaExpression = getSchemaExpressionText(property, sourceFile);
      continue;
    }

    if (!ts.isPropertyAssignment(property)) {
      throw new WorkflowSourceError("createWorkflow properties must be literal assignments");
    }

    const key = propertyNameText(property.name);
    if (key === HANDLER_PROPERTY) {
      if (hasHandler) throw new WorkflowSourceError("createWorkflow must define one handler");
      hasHandler = true;
      continue;
    }
    if (key === SCHEMA_PROPERTY) {
      if (schemaExpression !== undefined) {
        throw new WorkflowSourceError("createWorkflow must define at most one schema");
      }
      schemaExpression = getSchemaExpressionText(property, sourceFile);
      continue;
    }
    if (key === ENABLED_PROPERTY) {
      if (sawEnabled) throw new WorkflowSourceError("createWorkflow must define at most one enabled");
      const value = literalValueFromExpression(property.initializer);
      if (typeof value !== "boolean") {
        throw new WorkflowSourceError("createWorkflow enabled must be a boolean literal");
      }
      enabled = value;
      sawEnabled = true;
      continue;
    }
    if (REMOVED_WORKFLOW_KEYS.has(key)) {
      throw new WorkflowSourceError(`createWorkflow no longer supports ${key}`);
    }
    if (Object.hasOwn(meta, key)) {
      throw new WorkflowSourceError(`workflow metadata duplicates key "${key}"`);
    }
    meta[key] = literalValueFromExpression(property.initializer);
  }

  if (!hasHandler) throw new WorkflowSourceError("createWorkflow must define a handler");
  return { meta, schemaExpression, enabled };
};

const parseWorkflowSource = (source: string, sourcePath: string): ParsedWorkflowSource => {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);
  const defaultExport = getDefaultCreateWorkflowExport(sourceFile);
  const definition = getCreateWorkflowObject(defaultExport);
  const extracted = extractWorkflowMeta(definition, sourceFile);
  const parsedMeta = workflowMetaSchema.safeParse(extracted.meta);
  if (!parsedMeta.success) throw parsedMeta.error;

  const definitionText = definitionWithoutBuildTimeProps(definition, sourceFile);
  const edits: SourceEdit[] = [
    {
      range: getNodeRange(source, defaultExport),
      replacement: `export const ${BUNDLED_DEFINITION_EXPORT} = ${definitionText};\n`,
    },
  ];
  if (extracted.schemaExpression) {
    edits.push(
      ...createSchemaOnlySourceEdits(source, sourceFile, extracted.schemaExpression, definitionText),
    );
  }
  const schemaEdits: SourceEdit[] =
    extracted.schemaExpression ?
      [
        {
          range: getNodeRange(source, defaultExport),
          replacement: `export const ${BUNDLED_SCHEMA_JSON_EXPORT} = ${TO_JSON_SCHEMA_IMPORT}(${extracted.schemaExpression}, { io: "input" });\n`,
        },
      ]
    : [];

  for (const statement of sourceFile.statements) {
    if (!isCreateWorkflowImport(statement)) continue;
    edits.push({ range: getNodeRange(source, statement), replacement: "" });
    schemaEdits.push({ range: getNodeRange(source, statement), replacement: "" });
  }

  return {
    meta: parsedMeta.data,
    definitionSource: applySourceEdits(source, edits),
    schemaSource:
      extracted.schemaExpression ?
        `import { toJSONSchema as ${TO_JSON_SCHEMA_IMPORT} } from "zod/v4";\n${applySourceEdits(source, schemaEdits)}`
      : undefined,
    enabled: extracted.enabled,
  };
};

const loaderForPath = (sourcePath: string): Loader => {
  if (sourcePath.endsWith(".tsx")) return "tsx";
  if (sourcePath.endsWith(".jsx")) return "jsx";
  if (sourcePath.endsWith(".ts")) return "ts";
  return "js";
};

const assertBodyParses = (body: string) => {
  new Function(`async function _check() {\n${body}\n}`);
};

const bundleWorkflowDefinition = async (definitionSource: string, sourcePath: string) => {
  const result = await esbuildBuild({
    stdin: {
      contents: definitionSource,
      loader: loaderForPath(sourcePath),
      resolveDir: dirname(sourcePath),
      sourcefile: sourcePath,
    },
    bundle: true,
    format: "iife",
    globalName: BUNDLED_WORKFLOW_GLOBAL,
    legalComments: "none",
    logLevel: "silent",
    platform: "neutral",
    target: "esnext",
    write: false,
  });
  const output = result.outputFiles[0]?.text;
  if (!output) throw new WorkflowSourceError("workflow definition bundling produced no output");
  return output.trim();
};

const bundleWorkflowArgsSchema = async (schemaSource: string, sourcePath: string) => {
  const result = await esbuildBuild({
    stdin: {
      contents: schemaSource,
      loader: loaderForPath(sourcePath),
      resolveDir: dirname(sourcePath),
      sourcefile: sourcePath,
    },
    bundle: true,
    format: "iife",
    globalName: BUNDLED_SCHEMA_GLOBAL,
    legalComments: "none",
    logLevel: "silent",
    platform: "neutral",
    target: "esnext",
    write: false,
  });
  const output = result.outputFiles[0]?.text;
  if (!output) throw new WorkflowSourceError("workflow args schema bundling produced no output");

  const schemaJson: unknown = new Function(
    `${output}\nreturn ${BUNDLED_SCHEMA_GLOBAL}.${BUNDLED_SCHEMA_JSON_EXPORT};`,
  )();
  return schemaJson;
};

const renderWorkflowArgsSchema = (schemaJson: unknown) => {
  const rendered = JSON.stringify(schemaJson, null, 2);
  if (!rendered) throw new WorkflowSourceError("workflow args schema did not serialize to JSON");
  return rendered;
};

const appendArgsSchemaToWhenToUse = (meta: WorkflowMeta, schemaJson: unknown): WorkflowMeta => {
  const appendix = `${ARGS_SCHEMA_WHEN_TO_USE_HEADER}\n${renderWorkflowArgsSchema(schemaJson)}`;
  return {
    ...meta,
    whenToUse: meta.whenToUse ? `${meta.whenToUse.trimEnd()}\n\n${appendix}` : appendix,
  };
};

const renderWorkflowBody = async (parsed: ParsedWorkflowSource, sourcePath: string) => {
  const bundled = await bundleWorkflowDefinition(parsed.definitionSource, sourcePath);
  const globals = `{ ${SANDBOX_GLOBAL_NAMES.join(", ")} }`;
  const body = `${bundled}

const __cccWorkflowParseArgs = (value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

return (0, ${BUNDLED_WORKFLOW_GLOBAL}.${BUNDLED_DEFINITION_EXPORT}.handler)({
  ...${globals},
  args: __cccWorkflowParseArgs(args),
});`;
  assertBodyParses(body);
  return body;
};

const renderWorkflowMeta = async (
  parsed: ParsedWorkflowSource,
  canonicalName: string | undefined,
  sourcePath: string,
) => {
  const baseMeta = canonicalName ? { ...parsed.meta, name: canonicalName } : parsed.meta;
  if (!parsed.schemaSource) return baseMeta;

  const schemaJson = await bundleWorkflowArgsSchema(parsed.schemaSource, sourcePath);
  return appendArgsSchemaToWhenToUse(baseMeta, schemaJson);
};

const renderWorkflowContent = (meta: WorkflowMeta, body: string) => {
  return `export const meta = ${JSON.stringify(meta, null, 2)};\n\n${body}\n`;
};

const sourcePathForReference = (reference: string, baseDir: string) => {
  return resolve(baseDir, reference);
};

const loadWorkflowSource = async (
  sourcePath: string,
  ctx: ResolveContext,
  canonicalName?: string,
): Promise<LoadedWorkflow | null> => {
  if (!existsSync(sourcePath)) {
    log.warn("WORKFLOWS", `workflow source does not exist: ${sourcePath}`);
    return null;
  }

  const source = readFileSync(sourcePath, "utf8");
  if (rejectOversizeWorkflow(sourcePath, source)) return null;

  try {
    const parsed = parseWorkflowSource(source, sourcePath);
    if (!parsed.enabled) {
      log.info("WORKFLOWS", `${sourcePath} is disabled (enabled: false); skipping.`);
      return null;
    }
    const meta = await renderWorkflowMeta(parsed, canonicalName, sourcePath);
    if (!isSafeWorkflowName(meta.name)) {
      log.warn("WORKFLOWS", `${sourcePath} has unsafe workflow name: ${meta.name}`);
      return null;
    }

    const body = await renderWorkflowBody(parsed, sourcePath);
    const content = renderWorkflowContent(meta, body);
    if (rejectOversizeWorkflow(meta.name, content)) return null;

    return {
      filename: `${meta.name}.js`,
      content,
      sourcePath,
      trace: createWorkflowTrace(ctx.traceLayer, ctx.layerName),
    };
  } catch (error) {
    log.warn("WORKFLOWS", formatConfigError(error, ctx.errorLayer, ctx.layerName, sourcePath));
    return null;
  }
};

const setLoadedWorkflow = (workflows: Map<string, LoadedWorkflow>, workflow: LoadedWorkflow) => {
  const existing = workflows.get(workflow.filename);
  if (existing) {
    log.warn(
      "WORKFLOWS",
      `Workflow ${workflow.filename} from ${workflow.sourcePath} overrides ${existing.sourcePath} in the same layer`,
    );
  }
  workflows.set(workflow.filename, workflow);
};

const loadWorkflowsFromPath = async (
  dirPath: string,
  layer: ConfigLayer,
  layerName?: string,
): Promise<Map<string, LoadedWorkflow>> => {
  const workflows = new Map<string, LoadedWorkflow>();
  if (!existsSync(dirPath)) return workflows;

  const stems = new Set<string>();
  for (const entry of readdirSync(dirPath)) {
    if (entry.startsWith(".")) continue;
    if (entry.endsWith(".ts")) stems.add(entry.slice(0, -3));
    else if (entry.endsWith(".js")) stems.add(entry.slice(0, -3));
  }

  for (const stem of Array.from(stems).sort()) {
    const tsPath = join(dirPath, `${stem}.ts`);
    const jsPath = join(dirPath, `${stem}.js`);
    const sourcePath = existsSync(tsPath) ? tsPath : jsPath;

    if (existsSync(tsPath) && existsSync(jsPath)) {
      log.warn("WORKFLOWS", `Using ${stem}.ts over ${stem}.js in ${dirPath}`);
    }

    const loaded = await loadWorkflowSource(sourcePath, {
      errorLayer: layer,
      traceLayer: layer,
      layerName,
    });
    if (loaded) setLoadedWorkflow(workflows, loaded);
  }

  return workflows;
};

const applyWorkflow = (result: WorkflowBuildResult, workflow: LoadedWorkflow) => {
  result.files.set(workflow.filename, workflow.content);
  result.traces[workflow.filename] = [...(result.traces[workflow.filename] ?? []), workflow.trace];
};

export const buildWorkflows = async (context: Context): Promise<WorkflowBuildResult> => {
  const result: WorkflowBuildResult = { files: new Map(), traces: {} };
  const configBase = resolveConfigDirectoryPath(context.launcherDirectory, context.configDirectory);

  const globalPath = join(configBase, "global", "workflows");
  for (const workflow of (await loadWorkflowsFromPath(globalPath, "global")).values()) {
    applyWorkflow(result, workflow);
    log.info("WORKFLOWS", `Loaded global workflow: ${workflow.filename}`);
  }

  for (const preset of context.project.presets) {
    const presetPath = join(configBase, "presets", preset.name, "workflows");
    for (const workflow of (await loadWorkflowsFromPath(presetPath, "preset", preset.name)).values()) {
      applyWorkflow(result, workflow);
      log.info("WORKFLOWS", `Loaded preset workflow (${preset.name}): ${workflow.filename}`);
    }
  }

  if (context.project.projectConfig) {
    const projectPath = join(configBase, "projects", context.project.projectConfig.name, "workflows");
    for (const workflow of (
      await loadWorkflowsFromPath(projectPath, "project", context.project.projectConfig.name)
    ).values()) {
      applyWorkflow(result, workflow);
      log.info("WORKFLOWS", `Loaded project workflow: ${workflow.filename}`);
    }
  }

  const pluginWorkflows = getPluginWorkflows(context.loadedPlugins);
  for (const [namespacedName, entry] of Object.entries(pluginWorkflows)) {
    if (!isSafeWorkflowName(namespacedName)) {
      log.warn("WORKFLOWS", `Skipping plugin workflow with unsafe name: ${namespacedName}`);
      continue;
    }

    const sourcePath = sourcePathForReference(entry.config, entry.plugin.root);
    const loaded = await loadWorkflowSource(
      sourcePath,
      {
        errorLayer: "global",
        traceLayer: "plugin",
        layerName: entry.plugin.manifest.name,
      },
      namespacedName,
    );
    if (!loaded) continue;

    if (result.files.has(loaded.filename)) {
      log.warn(
        "WORKFLOWS",
        `Skipping plugin workflow ${loaded.filename} - already defined by a config layer`,
      );
      continue;
    }
    applyWorkflow(result, loaded);
    log.info("WORKFLOWS", `Loaded plugin workflow: ${loaded.filename}`);
  }

  log.info("WORKFLOWS", `Total workflows loaded: ${result.files.size}`);
  return result;
};
