<img width="40" height="885" alt="image" src="https://github.com/user-attachments/assets/eaaf1e59-05fc-41a6-b41d-c5c78a6b573b"/>

---

**CCC** es un lanzador para Claude Code que te permite configurar prompts, comandos, agentes, hooks y MCPs desde un solo lugar, **de manera estratificada**.

**Lo que obtienes**

- **Configuración Dinámica**: Genera prompts de sistema/usuario, comandos y agentes dinámicamente.
- **Configuración por Capas**: Fusiona la configuración global con presets y anulaciones (overrides) por proyecto.
- **Extensibilidad de bajo esfuerzo**: Escribe hooks y MCPs en TypeScript con ayudantes minimalistas.

<img width="2089" height="885" alt="image" src="https://github.com/user-attachments/assets/f3483ce9-a001-4ee4-a801-7550dde9a1ae" />

> No afiliado a Anthropic. Utiliza el CLI oficial de `@anthropic-ai/claude-code`.

> Advertencia: No probado en Windows, abre un issue si encuentras problemas.

---

## Primeros Pasos

### 1. Configuración

```bash
# clona este repo en algún lugar donde quieras mantener tu configuración
git clone https://github.com/3rd/ccc.git ~/my-claude-launcher
cd ~/my-claude-launcher

# instala dependencias y enlaza `ccc`
bun install
bun link

# instala tsx globalmente (requerido para la intercepción del runtime)
bun add -g tsx
```

**Nota**: Claude Code (`@anthropic-ai/claude-code`) está incluido como dependencia.
\
Bun debe estar disponible en el `PATH` durante el tiempo de ejecución porque CCC lanza los ayudantes de hooks y de la línea de estado con `bun`.
\
Para actualizarlo a la última versión, ejecuta `bun update`.

### 2. Personaliza tu configuración

Tu configuración reside en el directorio `./config`, que incluye algunos ejemplos por defecto.

```
~/my-claude-launcher/     # Tu copia de este repositorio
└── config/
    ├── global/           # Configuración global
    │   ├── prompts/      # Prompts de sistema (estilo de salida) / usuario (CLAUDE.md)
    │   ├── commands/     # Tus comandos
    │   ├── agents/       # Tus sub-agentes
    │   ├── skills/       # Tus habilidades (skills)
    │   ├── hooks.ts      # Tus hooks
    │   └── mcps.ts       # Tus MCPs
    ├── presets/          # Tus configs específicas de lenguaje/framework/etc.
    │   └── typescript/   # Ejemplo: Ajustes específicos de TypeScript
    └── projects/         # Tus anulaciones específicas por proyecto
        └── myapp/        # Ejemplo: Ajustes para tu proyecto 'myapp'
```

**Modo de Desarrollo**: Si existe un directorio `./dev-config`, este se utilizará en lugar de `./config`. Esto te permite mantener la configuración de ejemplo en `./config` (en commit en git) mientras usas `./dev-config` para tu configuración de desarrollo real.

### 3. Uso

**Tu flujo de trabajo**:

1. Edita tu config en `~/my-claude-launcher/config/`
2. Ejecuta `ccc` en lugar de `claude` desde cualquier lugar
3. Tu configuración se construye y carga dinámicamente

```sh
ccc # envuelve y lanza claude
ccc --continue # todos los argumentos que pases se enviarán a claude

# excepto estos casos especiales usados para depuración
ccc --doctor
ccc --print-config
ccc --print-system-prompt
ccc --print-user-prompt
ccc --dump-config
ccc --debug-mcp <mcp-name>
ccc --doru # flag exclusivo del lanzador; colócalo antes de los args de Claude
ccc --doru --continue
```

`ccc --doru` ejecuta CCC a través de `npx doru --ui` y abre automáticamente la interfaz en vivo de doru. Trata `--doru` como un flag inicial exclusivo del lanzador y colócalo antes de cualquier argumento de Claude. La primera ejecución puede descargar `doru`, y doru requiere `npx` más Node.js 22+.

## Capas de Configuración

`ccc` carga las configuraciones en capas (las posteriores anulan a las anteriores):

1. **Global** → `config/global/` - Configuración base para todos los proyectos
2. **Presets** → `config/presets/` - Detectados automáticamente según el tipo de proyecto
3. **Projects** → `config/projects/` - Anulaciones específicas del proyecto

Cada capa puede definir:

- `settings.ts` - Ajustes que irán al `settings.json` de Claude Code
- `prompts/user.{md,ts}` - Instrucciones de usuario (CLAUDE.md)
- `prompts/system.{md,ts}` - Estilo de salida
- `commands/*.{md,ts}` - Comandos slash personalizados
- `agents/*.{md,ts}` - Sub-agentes personalizados
- `skills/*/SKILL.{md,ts}` - Habilidades personalizadas (y archivos de soporte)
- `hooks.ts` - Hooks personalizados
- `mcps.ts` - MCPs personalizados

## Cómo Funciona

`ccc` inyecta configuraciones utilizando una superposición de sistema de archivos virtual (virtual filesystem overlay). Tu instalación real de Claude permanece intacta.
Las configuraciones se inyectan en tiempo de ejecución mediante la intercepción de módulos de Node.js.

El lanzador:

1. Descubre y fusiona las configuraciones de todas las capas
2. Genera un vfs con la configuración fusionada
3. Intercepta los módulos de Node para servir archivos virtuales
4. Lanza Claude con la configuración inyectada

```
Global  ┐
Preset  ├─► merge ─► "virtual overlay" ─► Claude Code
Project ┘
```

## Uso de Modelos de Otros Proveedores

Puedes configurar CCC para usar modelos de otros proveedores definiendo variables de entorno en tu `settings.ts`. Esto te permite usar modelos como GLM, Kimi K2 o Deepseek a través de sus APIs compatibles con Anthropic.

### Ejemplos de Configuración

Añade estas variables de entorno a tu `config/global/settings.ts`:

```typescript
import { createConfigSettings } from "@/config/helpers";

export default createConfigSettings({
  env: {
    // GLM 4.5
    ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
    ANTHROPIC_AUTH_TOKEN: "Z_API_KEY",
    ANTHROPIC_MODEL: "glm-4.5",
    ANTHROPIC_FAST_MODEL: "glm-4.5-air",

    // Kimi K2
    // ANTHROPIC_BASE_URL: "https://api.moonshot.ai/anthropic",
    // ANTHROPIC_AUTH_TOKEN: "KIMI_API_KEY",

    // Deepseek
    // ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
    // ANTHROPIC_AUTH_TOKEN: "DEEPSEEK_API_KEY",
    // ANTHROPIC_MODEL: "deepseek-chat",
    // ANTHROPIC_FAST_MODEL: "deepseek-chat"
  }
});
```

### Variables de Entorno

- `ANTHROPIC_BASE_URL` - La URL base del endpoint de la API del proveedor
- `ANTHROPIC_AUTH_TOKEN` - Tu clave de API del proveedor
- `ANTHROPIC_MODEL` - El modelo principal a utilizar (ej., "glm-4.5", "deepseek-chat")
- `ANTHROPIC_FAST_MODEL` - El modelo a utilizar para operaciones rápidas (opcional)

### Uso

Una vez configurado, CCC utilizará automáticamente los modelos del proveedor especificado en lugar de los de Anthropic. Todas las funciones de CCC, como prompts, comandos, agentes, hooks y MCPs, seguirán funcionando con los modelos alternativos.

**Nota**: Asegúrate de tener las claves de API necesarias y de que la API del proveedor sea compatible con el formato de la API de Anthropic.

## Configuración Extra

Algunos ajustes se seguirán leyendo de tu `~/.claude.json` global:

```bash
# cosas como estas:
claude config set -g autocheckpointingEnabled true
claude config set -g diffTool delta
claude config set -g supervisorMode true
claude config set -g autoCompactEnabled true
claude config set --global preferredNotifChannel terminal_bell
claude config set -g verbose true
```

## Ajustes de Argumentos CLI

Algunos ajustes se pasan directamente como argumentos de CLI a Claude en lugar de escribirse en `settings.json`. Estos se agrupan bajo `settings.cli`. Consulta la [Referencia del CLI de Claude Code](https://code.claude.com/docs/en/cli-reference#cli-flags) para más detalles.

```typescript
// config/global/settings.ts
import { createConfigSettings } from "@/config/helpers";

export default createConfigSettings({
  cli: {
    tools: ["Bash", "Read", "Edit", "Write"],
    disallowedTools: ["WebSearch", "WebFetch"],
    allowedTools: ["Read", "Glob", "Grep"],
    addDir: ["/path/to/shared/libs"],
    permissionMode: "plan",
    verbose: true,
    debug: "api,hooks",
    chrome: true,
    ide: true,
    enableLspLogging: false,
    agent: "code-reviewer",
  },
  // otros ajustes van a settings.json normalmente
  env: { ... },
});
```

### Ajustes Disponibles Solo para CLI

| Ajuste | Tipo | Flag CLI | Descripción |
|---------|------|----------|-------------|
| `tools` | `string[] \| "default"` | `--tools "Tool1,Tool2"` | Herramientas disponibles (`"default"` para todas, `[]` para desactivar) |
| `disallowedTools` | `string[]` | `--disallowedTools "Tool1,Tool2"` | Herramientas eliminadas completamente del contexto del modelo |
| `allowedTools` | `string[]` | `--allowedTools "Tool1,Tool2"` | Herramientas que se ejecutan sin prompts de permiso |
| `addDir` | `string[]` | `--add-dir path` | Directorios adicionales a los que Claude puede acceder |
| `permissionMode` | `enum` | `--permission-mode mode` | Modo de inicio: `default`, `acceptEdits`, `plan`, `bypassPermissions` |
| `verbose` | `boolean` | `--verbose` | Habilita el registro detallado (verbose logging) |
| `debug` | `boolean \| string` | `--debug [filter]` | Habilita el modo debug, opcionalmente con filtro de categoría |
| `chrome` | `boolean` | `--chrome` / `--no-chrome` | Habilita/deshabilita la integración con el navegador Chrome |
| `ide` | `boolean` | `--ide` | Conexión automática al IDE al iniciar |
| `enableLspLogging` | `boolean` | `--enable-lsp-logging` | Habilita el registro detallado de LSP |
| `agent` | `string` | `--agent name` | Agente predeterminado para la sesión |
| `agents` | `Record<string, AgentDef>` | `--agents JSON` | Definiciones de sub-agentes personalizados |
| `forkSession` | `boolean` | `--fork-session` | Crea un nuevo ID de sesión al reanudar |
| `fallbackModel` | `string` | `--fallback-model name` | Modelo de respaldo cuando el principal está saturado |
| `settingSources` | `string[]` | `--setting-sources "user,project,local"` | Fuentes de configuración a utilizar |
| `strictMcpConfig` | `boolean` | `--strict-mcp-config` | Solo utiliza la configuración de MCP especificada |

### Anulación por CLI

Los argumentos de CLI proporcionados directamente a `ccc` anulan los valores correspondientes de `settings.cli`:

```bash
# anular disallowedTools de los settings
ccc --disallowedTools "WebSearch,WebFetch"

# iniciar en modo plan independientemente de los settings
ccc --permission-mode plan
```

---

## Prompts de Sistema y Usuario

### Prompt de Sistema (Estilo de Salida)

Controla cómo responde y se comporta Claude.

**Estático (Markdown)** (`config/global/prompts/system.md`):

```markdown
Eres un asistente de programación servicial.
Escribe código limpio y mantenible.
Sigue las mejores prácticas.
```

**Dinámico (TypeScript)** (`config/global/prompts/system.ts`):

```typescript
import { createPrompt } from "@/config/helpers";

export default createPrompt(
  (context) => `
Estás trabajando en ${context.workingDirectory}
${context.isGitRepo() ? `Rama actual: ${context.getGitBranch()}` : ""}
Escribe código limpio y mantenible.
`,
);
```

**Modo Append** (añade a las capas anteriores):

```typescript
import { createAppendPrompt } from "@/config/helpers";

export default createAppendPrompt(
  (context) => `
Instrucciones adicionales para este preset.
`,
);
```

También puedes usar archivos Markdown en modo append, simplemente nómbralos: `<target>.append.md`


### Prompt de Usuario (CLAUDE.md)

Instrucciones y contexto específicos del proyecto. Mira `config/global/prompts/user.ts` para un ejemplo completo:

```typescript
import { createPrompt } from "@/config/helpers";

export default createPrompt(
  (context) => `
# REGLAS CRÍTICAS

Haz exactamente lo que el usuario pide. Sin alternativas, sin soluciones "mejores"...

Trabajando en: ${context.workingDirectory}
Rama de Git: ${context.getGitBranch()}
`,
);
```

## Comandos

Comandos slash personalizados disponibles en Claude. Mira `config/global/commands/` para ejemplos:

**Estático (Markdown)** (`config/global/commands/review.md`):

```markdown
# Review

Review: "$ARGUMENTS"
Estás realizando una revisión de código...
```

**Dinámico (TypeScript)**:

```typescript
import { createCommand } from "@/config/helpers";

export default createCommand(
  (context) => `
# Comando Personalizado

Trabajando en ${context.workingDirectory}
Rama actual: ${context.getGitBranch()}

Instrucciones de tu comando aquí...
`,
);
```

**Append a comando existente**:

```typescript
import { createAppendCommand } from "@/config/helpers";

export default createAppendCommand(
  (context) => `
Instrucciones adicionales para proyectos TypeScript...
`,
);
```

## Habilidades (Skills)

Las habilidades son paquetes de instrucciones reutilizables que Claude puede invocar a través de la herramienta Skill. Defínelas como carpetas bajo `skills/` con un archivo `SKILL.md` (estático) o `SKILL.ts` (estructurado) y cualquier archivo de soporte (ej. `references/*.md`).

**Estática (Markdown)** (`config/global/skills/my-skill/SKILL.md`):

```markdown
---
name: my-skill
description: Verificaciones rápidas para el repo actual
allowed-tools:
  - Read
  - Grep
---

Usa esta habilidad para realizar verificaciones rápidas del repositorio y resumir los hallazgos.
```

**Estructurada (TypeScript)** (`config/global/skills/my-skill/SKILL.ts`):

```typescript
import { createSkill } from "@/config/helpers";

export default createSkill((context) => ({
  description: `Verificaciones para ${context.project.name}`,
  content: `
Ejecuta un análisis dirigido para ${context.workingDirectory}.
Usa $ARGUMENTS para aceptar parámetros.
`,
  allowedTools: ["Read", "Grep"],
  userInvocable: true,
  disableModelInvocation: false,
  hooks: {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [{ type: "command", command: "echo 'Skill hook'" }],
      },
    ],
  },
}));
```

Las capas de habilidades se resuelven en el orden: global, luego preset, luego proyecto. Una habilidad estructurada puede establecer `mode: "append"` para añadir el cuerpo de su `SKILL.md` a una habilidad anterior con el mismo nombre mientras mantiene los metadatos de la habilidad base; si se omite el modo, se comporta como un override.

## Hooks

Manejadores de eventos que se ejecutan en eventos específicos de Claude. Mira `config/global/hooks.ts` para ejemplos:

**Ejemplos de hooks globales**:

```typescript
import p from "picocolors";
import { createHook } from "@/hooks/hook-generator";
import { createConfigHooks } from "@/config/helpers";

const bashDenyList = [
  {
    match: /^\bgit\bcheckout/,
    message: "No tienes permiso para hacer checkouts o resets",
  },
  {
    match: /^\bgrep\b(?!.*\|)/,
    message: "Usa 'rg' (ripgrep) en lugar de 'grep' para un mejor rendimiento",
  },
];

const sessionStartHook = createHook({
  event: "SessionStart",
  id: "global-session-start",
  handler: (input) => {
    const timestamp = new Date().toISOString();
    console.log(p.dim("🞄"));
    console.log(
      `🚀 Sesión iniciada desde ${p.yellow(input.source)} a las ${p.blue(timestamp)}`,
    );
    console.log(`📍 Directorio de trabajo: ${p.yellow(process.cwd())}`);
    console.log(`🔧 Versión de Node: ${p.yellow(process.version)}`);
    console.log(p.dim("🞄"));
  },
});

const preBashValidationHook = createHook({
  event: "PreToolUse",
  id: "bash-deny-list",
  handler: (input) => {
    const command = input.tool_input.command as string;
    if (input.tool_name !== "Bash" || !command) return;
    const firstMatchingRule = bashDenyList.find((rule) =>
      command.match(rule.match),
    );
    if (!firstMatchingRule) return;
    return {
      continue: true,
      decision: "block",
      reason: firstMatchingRule?.message,
    };
  },
});

export default createConfigHooks({
  SessionStart: [{ hooks: [sessionStartHook] }],
  PreToolUse: [{ hooks: [preBashValidationHook] }],
});
```

**Opciones de Hook**:

```typescript
const oneTimeHook = createHook({
  event: "SessionStart",
  id: "one-time-setup",
  handler: (input) => {
    // esto solo se ejecutará una vez por sesión
    console.log("Solo al inicio de la primera sesión");
  },
  timeout: 5,     // opcional: timeout en segundos
  once: true,     // opcional: ejecutar solo la primera vez por sesión
});
```

**Ejemplo de Validación de TypeScript** (`config/presets/typescript/hooks.ts`):

```typescript
import { $ } from "zx";
import { createHook } from "@/hooks/hook-generator";
import { createConfigHooks } from "@/config/helpers";

export default createConfigHooks({
  Stop: [
    {
      hooks: [
        createHook({
          event: "Stop",
          id: "typescript-validation",
          handler: async () => {
            const result = await $`tsc --noEmit`;
            if (result.exitCode !== 0) {
              return {
                continue: true,
                decision: "block",
                reason: `Error en tsc --noEmit:\n${result.text()}`,
              };
            }
            return { suppressOutput: true };
          },
        }),
      ],
    },
  ],
});
```

## Agentes

Sub-agentes especializados para tareas específicas. Mira `config/global/agents/` para ejemplos:

**Estático (Markdown)** (`config/global/agents/code-reviewer.md`):

```markdown
---
name: code-reviewer
description: Revisa el código en busca de calidad y mejores prácticas
tools: [Read, Grep, Glob, Bash]
---

# Agente Revisor de Código

Eres un agente especializado en revisión de código que realiza **REVISIONES SISTEMÁTICAS BASADAS EN EVIDENCIAS**.

## Principios Fundamentales

**EVIDENCIA ANTES QUE OPINIÓN** - Proporciona siempre referencias de archivo:línea...
```

**Dinámico (TypeScript)**:

```typescript
import { createAgent } from "@/config/helpers";

export default createAgent(
  (context) => `
---
name: debugger
description: Depura problemas en ${context.project.name}
tools: [Read, Edit, Bash, Grep, Glob]
---

# Agente Depurador

Estás depurando código en ${context.workingDirectory}
Rama actual: ${context.getGitBranch()}
`,
);
```

## MCPs

Servidores del Model Context Protocol para extender las capacidades de Claude. Mira `config/global/mcps/` para ejemplos:

### MCPs Externos

```typescript
import { createConfigMCPs } from "@/config/helpers";

export default createConfigMCPs({
  filesystem: {
    command: "npx",
    args: ["@modelcontextprotocol/server-filesystem"],
    env: { FS_ROOT: "/home/user" },
  },
});
```

### Filtrado de Herramientas MCP

Puedes filtrar qué herramientas se exponen desde un MCP externo:

```typescript
import { createConfigMCPs } from "@/config/helpers";

export default createConfigMCPs({
  nixos: {
    command: "nix",
    args: ["run", "github:utensils/mcp-nixos", "--"],
    filter: (tool) => {
      // Excluir herramientas específicas
      return tool.name !== "nixos_search";
    },
  },
});
```

La función de filtro recibe un objeto de herramienta con propiedades `name` y `description`. Devuelve `true` para incluir la herramienta, `false` para excluirla.

### MCPs Personalizados

Puedes definir fácilmente MCPs personalizados en tu configuración usando FastMCP.

```typescript
import { FastMCP } from "fastmcp";
import { z } from "zod";
import { createConfigMCPs, createMCP } from "@/config/helpers";

const customTools = createMCP((context) => {
  const server = new FastMCP({
    name: "custom-tools",
    version: "1.0.0",
  });

  server.addTool({
    name: "getProjectInfo",
    description: "Obtener información del proyecto actual",
    parameters: z.object({}),
    execute: async () => {
      return JSON.stringify(
        {
          directory: context.workingDirectory,
          branch: context.getGitBranch(),
          isGitRepo: context.isGitRepo(),
        },
        null,
        2,
      );
    },
  });

  return server;
});

export default createConfigMCPs({
  "custom-tools": customTools,
});
```

## Plugins

CCC configura los plugins de Claude Code a través de archivos `plugins.ts` estratificados (global/preset/project). Los ajustes de los plugins de Claude residen bajo el espacio de nombres `claude`.

### Flujo de Trabajo

1. Instala los plugins usando el comando `/plugin`
2. Encuentra las claves de los plugins en `~/.claude/plugins/installed_plugins.json`
3. Habilita los plugins en tu capa `plugins.ts`

### Habilitando Plugins de Claude

```typescript
// config/global/plugins.ts
import { createConfigPlugins } from "@/config/helpers";

export default createConfigPlugins({
  claude: {
    enabledPlugins: {
      // Usa las claves de ~/.claude/plugins/installed_plugins.json
      "typescript-lsp@claude-plugins-official": true,
      "gopls-lsp@claude-plugins-official": true,
    },
  },
});
```

### Directorios de Plugins Locales

```typescript
// config/global/plugins.ts
import { createConfigPlugins } from "@/config/helpers";

export default createConfigPlugins({
  claude: {
    pluginDirs: [
      "./claude-plugins/my-plugin",
    ],
  },
});
```

También puedes colocar plugins locales en `config/claude-plugins/` y CCC los descubrirá automáticamente.
Anulación por CLI: `ccc --plugin-dir ./path/to/plugin`

### Soporte para Plugins LSP

Los plugins LSP son soportados nativamente. Solo habilita tus plugins LSP normalmente:

```typescript
export default createConfigPlugins({
  claude: {
    enabledPlugins: {
      "typescript-lsp@claude-plugins-official": true,
    },
  },
});
```

## Plugins de CCC

CCC tiene su propio sistema de plugins para empaquetar componentes de configuración reutilizables. A diferencia de los plugins integrados de Claude (configurados vía `plugins.ts` bajo `claude`), los plugins de CCC son módulos de TypeScript locales que pueden definir comandos, agentes, MCPs, hooks y prompts dinámicamente, y que tienen acceso a información enriquecida sobre la sesión actual.

### Plugins de CCC vs Plugins de Claude

| Aspecto | Plugins de CCC (`plugins.ts` → `ccc`) | Plugins de Claude (`plugins.ts` → `claude`) |
|--------|---------------------------|-----------------------------------|
| **Ubicación** | Directorio `config/plugins/` | `~/.claude/plugins/` (instalados) o raíces locales vía `config/claude-plugins/` |
| **Formato** | TypeScript con `createPlugin()` | Formato de plugin de Claude |
| **Componentes** | comandos, agentes, MCPs, hooks, prompts | Definidos por Claude |
| **Distribución** | Local en tu config | Vía comando `/plugin` |

### Estructura del Plugin

Un plugin de CCC requiere dos archivos:

```
config/plugins/my-plugin/
├── plugin.json    # Manifiesto con nombre, versión, descripción
└── index.ts       # Definición del plugin usando createPlugin()
```

**plugin.json** (manifiesto):

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Un plugin personalizado de CCC"
}
```

**index.ts** (definición):

```typescript
import { createPlugin } from "@/config/helpers";

export default createPlugin({
  // Comandos - comandos slash personalizados
  commands: (context) => ({
    "my-command": {
      content: `
# Mi Comando
Instrucciones de tu comando aquí...
      `.trim(),
      mode: "override",
    },
  }),

  // Agentes - sub-agentes especializados
  agents: (context) => ({
    "my-agent": {
      content: `
---
name: my-agent
description: Un agente especializado
tools: [Read, Grep, Glob]
---
Instrucciones del agente...
      `.trim(),
      mode: "override",
    },
  }),

  // MCPs - servidores MCP integrados
  mcps: (context) => ({
    "my-mcp": {
      type: "inline",
      config: () => createMyMCP(context),
    },
  }),

  // Hooks - manejadores de eventos
  hooks: (context) => ({
    Stop: [
      {
        hooks: [
          createHook({
            event: "Stop",
            id: "plugin-stop-hook",
            handler: () => {
              // Lógica del hook
            },
          }),
        ],
      },
    ],
  }),

  // Prompts - adiciones a prompts de sistema/usuario
  prompts: (context) => ({
    user: {
      content: "Contenido adicional del prompt de usuario",
      mode: "append",
    },
  }),
});
```

### Habilitando Plugins de CCC

Habilita los plugins de CCC a través de `plugins.ts`:

```typescript
// config/global/plugins.ts
import { createConfigPlugins } from "@/config/helpers";

export default createConfigPlugins({
  ccc: {
    "my-plugin": true,           // Habilitar plugin
    "another-plugin": false,     // Deshabilitar explícitamente
  },
});
```

También puedes habilitar plugins en presets:

```typescript
// config/presets/typescript/plugins.ts
import { createConfigPlugins } from "@/config/helpers";

export default createConfigPlugins({
  ccc: {
    "typescript-helpers": true,
  },
});
```

### Contexto del Plugin

Los plugins reciben un `PluginContext` con acceso a:

```typescript
{
  // Propiedades de contexto estándar
  workingDirectory: string;
  launcherDirectory: string;
  instanceId: string;
  project: Project;                  // Instancia de proyecto con config
  mcpServers?: Record<string, ClaudeMCPConfig>; // Configs de MCP procesadas para esta ejecución
  isGitRepo(): boolean;              // Verificar si está en repositorio git
  getGitBranch(): string;            // Rama actual de git
  getGitStatus(): string;            // Estado de git (porcelain)
  getGitRecentCommits(n): string;    // Historial de commits recientes
  getDirectoryTree(): string;        // Estructura de directorios
  getPlatform(): string;             // Plataforma del SO
  getOsVersion(): string;            // Info de versión del SO
  getCurrentDateTime(): string;      // Timestamp ISO
  hasMCP(name: string): boolean;     // True si el MCP con ese nombre está configurado
}
```

### Estado del Plugin

Los plugins pueden persistir el estado utilizando la API de estado integrada. El estado se guarda automáticamente en disco y se restaura entre sesiones.

**API de Estado:**

```typescript
context.state.get<T>(key: string): T | undefined  // Obtener un valor
context.state.set(key: string, value: unknown): void  // Establecer un valor
context.state.clear(): void  // Limpiar todo el estado
context.state.getAll(): Record<string, unknown>  // Obtener todo el estado
```

**Ubicaciones del Estado:**

Por defecto, el estado del plugin se almacena en `/tmp/ccc-plugin-{name}-{sessionId}.json`. La ubicación está aislada por ID de sesión (CCC_INSTANCE_ID) para evitar conflictos entre instancias concurrentes de CCC.

| Ubicación | Ruta | Caso de Uso |
|----------|------|----------|
| `temp` (defecto) | `/tmp/ccc-plugin-{name}-{sessionId}.json` | Datos con alcance de sesión |
| `project` | `{cwd}/.ccc/state/plugins/{name}.json` | Datos persistentes específicos del proyecto |
| `user` | `~/.ccc/state/plugins/{name}.json` | Preferencias globales del usuario |

**Ejemplo - MCP con Estado:**

```typescript
export default createPlugin({
  mcps: (context) => ({
    "stateful-mcp": {
      type: "inline",
      config: () => {
        const server = new FastMCP({ name: "stateful", version: "1.0.0" });

        server.addTool({
          name: "save_data",
          parameters: z.object({ key: z.string(), value: z.string() }),
          execute: async (args) => {
            context.state.set(args.key, args.value);
            return "¡Guardado!";
          },
        });

        server.addTool({
          name: "load_data",
          parameters: z.object({ key: z.string() }),
          execute: async (args) => {
            return context.state.get(args.key) ?? "No encontrado";
          },
        });

        return server;
      },
    },
  }),
});
```

### Ajustes del Plugin

Los plugins definen ajustes usando **esquemas de Zod** en `index.ts`. El tipo se infiere automáticamente:

```typescript
// my-plugin/index.ts
import { z } from "zod";
import { createPlugin } from "@/config/helpers";

const settingsSchema = z.object({
  maxItems: z.number().default(100),
  mode: z.enum(["fast", "balanced", "thorough"]).default("balanced"),
});

export default createPlugin({
  settingsSchema,
  mcps: (context) => {
    // context.plugin.settings está tipado como { maxItems: number, mode: "fast" | "balanced" | "thorough" }
    const { maxItems, mode } = context.plugin.settings;
    // ...
  },
});
```

**Pasar ajustes al habilitar el plugin:**

```typescript
// config/global/plugins.ts
import { createConfigPlugins } from "@/config/helpers";

export default createConfigPlugins({
  ccc: {
    "my-plugin": {
      enabled: true,
      settings: {
        maxItems: 50,
        mode: "fast",
      },
    },
  },
});
```

Los ajustes se validan con Zod al cargar el plugin. Los ajustes inválidos lanzan errores.

### Estado del Plugin

Los plugins disponen de una API `context.state` para almacenamiento clave-valor:

```typescript
context.state.get<T>(key)      // obtener valor
context.state.set(key, value)  // establecer valor
context.state.clear()          // limpiar todo el estado
context.state.getAll()         // obtener todo el estado
```

**Por defecto, el estado es solo en memoria** (no persistido). Para persistir el estado, establece `stateType`:

```typescript
export default createPlugin({
  stateType: "temp",     // /tmp/ccc-plugin-{name}-{sessionId}.json (por instancia)
  // o:
  stateType: "project",  // {projectRoot}/.ccc/state/plugins/{name}.json
  // o:
  stateType: "user",     // ~/.ccc/state/plugins/{name}.json

  mcps: (context) => { /* ... */ },
});
```

| stateType | Ruta | Caso de uso |
|-----------|------|----------|
| `"none"` (defecto) | (solo en memoria) | No se necesita persistencia |
| `"temp"` | `/tmp/ccc-plugin-{name}-{sessionId}.json` | Estado por instancia, se borra al reiniciar |
| `"project"` | `{projectRoot}/.ccc/state/plugins/{name}.json` | Estado persistente específico del proyecto |
| `"user"` | `~/.ccc/state/plugins/{name}.json` | Estado persistente para todo el usuario |

### Hook onLoad

Los plugins pueden definir un callback `onLoad` para la inicialización:

```typescript
export default createPlugin({
  onLoad: async (context) => {
    console.log(`Plugin ${context.plugin.name} cargado`);
  },
  commands: () => ({ /* ... */ }),
});
```

### Comunicación entre Plugins

Los plugins pueden acceder a otros plugins cargados usando `getPlugin()`:

```typescript
export default createPlugin({
  mcps: (context) => ({
    "my-mcp": {
      type: "inline",
      config: () => {
        const server = new FastMCP({ name: "my-mcp", version: "1.0.0" });

        server.addTool({
          name: "get_other_plugin_data",
          parameters: z.object({}),
          execute: async () => {
            // Acceder al contexto de otro plugin
            const otherPlugin = context.getPlugin("other-plugin");
            if (!otherPlugin) return "Otro plugin no cargado";

            // Leer su estado
            const data = otherPlugin.state.get("shared-data");
            return JSON.stringify(data);
          },
        });

        return server;
      },
    },
  }),
});
```

### Dependencias de Plugins

Los plugins pueden declarar dependencias de otros plugins en `plugin.json`:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Depende de base-plugin",
  "dependencies": ["base-plugin", "utility-plugin"]
}
```

Las dependencias se cargan primero, asegurando que estén disponibles cuando se cargue tu plugin.

### Esquema Completo de plugin.json

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Un ejemplo completo de plugin",

  "author": "Tu Nombre",
  "license": "MIT",
  "homepage": "https://example.com/my-plugin",
  "repository": "https://github.com/user/my-plugin",

  "dependencies": ["other-plugin"]
}
```

Nota: Los ajustes se definen mediante el esquema Zod en `index.ts`, no en `plugin.json`.

### Ejemplo: Plugin Completo

Aquí tienes un ejemplo completo de un plugin con comandos, un MCP y hooks:

```typescript
// config/plugins/task-tracker/index.ts
import { FastMCP } from "fastmcp";
import { z } from "zod";
import { createPlugin } from "@/config/helpers";
import { createHook } from "@/hooks/hook-generator";

export default createPlugin({
  commands: () => ({
    "track": {
      content: `
# Task Tracker
Rastrea una nueva tarea: "$ARGUMENTS"
Usa la herramienta MCP task_add para añadir esta tarea.
      `.trim(),
      mode: "override",
    },
  }),

  mcps: (context) => ({
    "task-tracker": {
      type: "inline",
      config: () => {
        const server = new FastMCP({
          name: "task-tracker",
          version: "1.0.0",
        });

        server.addTool({
          name: "task_add",
          description: "Añadir una nueva tarea",
          parameters: z.object({
            title: z.string(),
            priority: z.enum(["low", "medium", "high"]).default("medium"),
          }),
          execute: async (args) => {
            const tasks = context.state.get<string[]>("tasks") ?? [];
            tasks.push(`[${args.priority}] ${args.title}`);
            context.state.set("tasks", tasks);
            return `Añadido: ${args.title}`;
          },
        });

        server.addTool({
          name: "task_list",
          description: "Listar todas las tareas",
          parameters: z.object({}),
          execute: async () => {
            const tasks = context.state.get<string[]>("tasks") ?? [];
            return tasks.length > 0 ? tasks.join("\n") : "Sin tareas";
          },
        });

        return server;
      },
    },
  }),

  hooks: () => ({
    SessionStart: [
      {
        hooks: [
          createHook({
            event: "SessionStart",
            id: "task-tracker-init",
            handler: () => {
              console.log("📋 Plugin Task Tracker cargado");
            },
          }),
        ],
      },
    ],
  }),
});
```

### Ver Información del Plugin

Usa `ccc --print-config` para ver los plugins de CCC cargados:

```
CCC Plugins:
  my-plugin (v1.0.0) [enabled]
    Commands: my-plugin:my-command
    MCPs: my-plugin:my-mcp
    Hooks: Stop(1)
```

Nota: Los componentes del plugin están englobados con el nombre del plugin (ej., `my-plugin:my-command`).

## Parches de Tiempo de Ejecución

Todos los parches del CLI se aplican en tiempo de ejecución; los archivos originales de `node_modules` nunca se modifican. El lanzador lee el CLI, aplica los parches, escribe en un archivo temporal y lo importa en su lugar.

### Parches Integrados

Se aplican automáticamente en cada lanzamiento:
- Desactiva las funciones de `pr-comments` y `security-review`

### Parches Definidos por el Usuario

Añade reemplazos de cadenas personalizados a través de los ajustes:

```typescript
export default createConfigSettings({
  patches: [
    { find: "ultrathink", replace: "uuu" },  // alias más corto
  ],
});
```

Los parches se aplican después de los parches integrados. No es necesario reinstalar al cambiar la configuración.

## Línea de Estado (Statusline)

Personaliza la línea de estado de Claude con un enfoque sencillo basado en la configuración.

### Orden de Prioridad

1. **`config/global/statusline.ts`** - Si este archivo existe, se ejecutará con `bun`
2. **`settings.statusLine`** - De lo contrario, usa la configuración statusLine de los ajustes
3. **Ninguno** - Si no hay ninguno configurado, no se muestra la línea de estado

### Creando una Línea de Estado

Crea `config/global/statusline.ts`:

```typescript
import { createStatusline } from "@/config/helpers";
import type { StatusLineInput } from "@/types/statusline";

export default createStatusline(async (data: StatusLineInput) => {
  const modelIcon = data.model?.id?.includes("opus") ? "🦆" : "🐇";
  const components = [];

  // Modelo e icono
  components.push(`${modelIcon} ${data.model.display_name }`);

  // Directorio de trabajo
  if (data.workspace) {
    const dir = data.workspace.project_dir || data.workspace.current_dir;
    const shortDir = dir.split("/").slice(-2).join("/");
    components.push(`📁 ${shortDir}`);
  }

  // Evento de hook (si está presente)
  if (data.hook_event_name) {
    components.push(`⚡ ${data.hook_event_name}`);
  }

  console.log(components.join(" │ "));
});
```

### Uso de Herramientas Externas

También puedes integrar herramientas de línea de estado externas:

```typescript
import { createStatusline } from "@/config/helpers";
import { $ } from "bun";

export default createStatusline(async (data) => {
  // Usa la herramienta externa ccstatusline
  const output = await $`echo ${JSON.stringify(data)} | bunx ccstatusline`.text();
  const modelIcon = data.model?.id?.includes("opus") ? "🦆" : "🐇";
  console.log(`${modelIcon} ${output.trim()}`);
});
```

### Tipo StatusLineInput

La función de la línea de estado recibe un objeto `StatusLineInput` con:
- `model.id` - Identificador del modelo (ej., "claude-3-opus-20240229")
- `model.display_name` - Nombre del modelo legible para humanos
- `workspace.current_dir` - Directorio de trabajo actual
- `workspace.project_dir` - Directorio raíz del proyecto
- `hook_event_name` - Evento de hook actual que se está ejecutando
- `session_id` - Identificador de la sesión actual
- `transcript_path` - Ruta al archivo de transcripción
- `cwd` - Directorio de trabajo actual
- `output_style` - Configuración del estilo de salida

### Configuración de Ajustes

Alternativamente, configura un comando de línea de estado personalizado en `settings.ts`:

```typescript
export default createConfigSettings({
  statusLine: {
    type: "command",
    command: "/path/to/your/statusline-script",
  },
});
```

**Nota:** A diferencia de otros tipos de configuración, las líneas de estado NO admiten estratificación o fusión. Solo se utiliza la configuración global o los ajustes.

## Doctor (Inspector de Configuración)

Usa `ccc --doctor` para imprimir un informe diagnóstico de tu configuración fusionada sin lanzar Claude:

```
ccc --doctor
ccc --doctor --json
```

El informe muestra:
- Presets detectados y configuración de proyecto en uso
- Trazas de estratificación (override/append) para prompts de sistema/usuario
- Trazas de estratificación por comando y por agente a través de global/presets/proyecto
- Servidores MCP y su tipo de transporte

## Dump de Configuración

Usa `ccc --dump-config` para crear un volcado completo de la configuración computada que ve Claude:

```bash
ccc --dump-config
```

Esto crea un directorio `.config-dump/{timestamp}/` que contiene:

- `system.md` - El prompt de sistema computado real
- `user.md` - El prompt de usuario computado real
- `commands/` - Todos los archivos de comandos tal como los ve Claude
- `agents/` - Todos los archivos de agentes tal como los ve Claude
- `settings.json` - Los ajustes fusionados
- `mcps.json` - Las configuraciones de MCP computadas
- `metadata.json` - Información de contexto y del volcado

Esto es útil para depurar problemas de configuración y entender exactamente qué es lo que ve Claude.

## Depurar MCPs

Usa `ccc --debug-mcp <mcp-name>` para lanzar el MCP Inspector para depurar servidores MCP:

```bash
ccc --debug-mcp filesystem
ccc --debug-mcp custom-tools
```

Esto lanza el [MCP Inspector](https://github.com/modelcontextprotocol/inspector) con tu servidor MCP, permitiéndote:
- Ver todas las herramientas, recursos y prompts disponibles
- Probar invocaciones de herramientas interactivamente
- Inspeccionar los payloads de solicitud/respuesta
- Depurar MCPs filtrados (muestra las herramientas después del filtrado)

**Nota**:
- Solo funciona con MCPs de transporte stdio (no HTTP/SSE)
- Los MCPs filtrados mostrarán las herramientas filtradas, no las originales
- Los MCPs integrados (creados con FastMCP) son soportados

## Configuración del Proyecto

Crea una configuración específica para el proyecto:

```typescript
// config/projects/myapp/project.ts
export default {
  name: "myapp",
  root: "/path/to/myapp",
  disableParentClaudeMds: false, // opcional, desactivará el comportamiento de Claude de cargar archivos CLAUDE.md superiores
};
```

```typescript
// config/projects/myapp/settings.ts
import { createConfigSettings } from "@/config/helpers";

export default createConfigSettings({
  env: {
    NODE_ENV: "development",
    API_URL: "http://localhost:3000",
  },
});
```

## Objeto de Contexto

Todas las configuraciones dinámicas reciben un objeto de contexto con algunas utilidades:

```typescript
{
  workingDirectory: string;          // Directorio de trabajo actual
  launcherDirectory: string;         // Ruta de la instalación del lanzador
  instanceId: string;                // Identificador único de instancia
  project: Project;                  // Instancia de proyecto con config
  mcpServers?: Record<string, ClaudeMCPConfig>; // Configs de MCP procesadas para esta ejecución
  isGitRepo(): boolean;              // Verificar si está en repositorio git
  getGitBranch(): string;            // Rama actual de git
  getGitStatus(): string;            // Estado de git (porcelain)
  getGitRecentCommits(n): string;    // Historial de commits recientes
  getDirectoryTree(): string;        // Estructura de directorios
  getPlatform(): string;             // Plataforma del SO
  getOsVersion(): string;            // Info de versión del SO
  getCurrentDateTime(): string;      // Timestamp ISO
  hasMCP(name: string): boolean;     // True si el MCP con ese nombre está configurado
}
```

## Otras cosas

- ?

---

## Licencia

Licencia MIT. Mira `LICENSE` para más detalles.
