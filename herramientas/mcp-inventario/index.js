#!/usr/bin/env node
// Servidor MCP de solo lectura sobre docs/inventario-servidores.csv.
// Transporte: stdio. stdout es el canal del protocolo: todo diagnóstico va a stderr.
// No escribe nada: lo único que usa del sistema de archivos es readFile.

import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Ruta fija, relativa a este archivo: no depende del directorio de trabajo
// y ninguna herramienta puede pedir otro archivo.
const RUTA_CSV = new URL('../../docs/inventario-servidores.csv', import.meta.url);
const NOMBRE_CSV = 'docs/inventario-servidores.csv';

// Columnas esperadas del CSV, en orden, con lo que significa cada una.
const DESCRIPCION_CAMPOS = {
  nombre: 'Nombre del servidor (ej. srv-app-prod-01, db-dev-01)',
  rol: 'Función del servidor (ej. servidor de aplicaciones, base de datos PostgreSQL)',
  sistema_operativo: 'Sistema operativo con versión (ej. RHEL 9.2, Ubuntu 22.04 LTS, Debian 12)',
  entorno: 'Entorno: desarrollo, qa o produccion (sin acento en el CSV)',
  responsable: 'Equipo responsable (ej. Equipo Datos, Equipo Operaciones TI)',
};
const CAMPOS = Object.keys(DESCRIPCION_CAMPOS);
const LARGO_MAXIMO = 100;

// Error esperado (archivo ausente, columnas distintas...): su mensaje se muestra al cliente.
class ErrorInventario extends Error {}

// Parser mínimo de RFC 4180: comillas, comillas dobles escapadas, CRLF o LF, BOM.
function parsearCsv(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let entreComillas = false;
  let i = texto.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === ',') {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (entreComillas) throw new ErrorInventario(`${NOMBRE_CSV} tiene comillas sin cerrar.`);
  if (campo !== '' || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  // Las líneas en blanco no son registros.
  return filas.filter((f) => !(f.length === 1 && f[0].trim() === ''));
}

// Lee y valida el CSV en cada llamada: si alguien lo edita, se ve sin reiniciar.
async function leerInventario() {
  let texto;
  try {
    texto = await readFile(RUTA_CSV, 'utf8');
  } catch (e) {
    throw new ErrorInventario(`No se pudo leer ${NOMBRE_CSV} (${e.code || 'error de lectura'}).`);
  }
  const filas = parsearCsv(texto);
  if (filas.length === 0) throw new ErrorInventario(`${NOMBRE_CSV} está vacío.`);

  const [encabezado, ...datos] = filas;
  const columnas = encabezado.map((h) => h.trim());
  if (columnas.length !== CAMPOS.length || columnas.some((h, i) => h !== CAMPOS[i])) {
    throw new ErrorInventario(
      `Las columnas de ${NOMBRE_CSV} no son las esperadas. ` +
        `Esperadas: ${CAMPOS.join(', ')}. Encontradas: ${columnas.join(', ')}.`,
    );
  }
  return datos.map((valores, n) => {
    if (valores.length !== CAMPOS.length) {
      throw new ErrorInventario(
        `El registro ${n + 1} de ${NOMBRE_CSV} tiene ${valores.length} campos; se esperaban ${CAMPOS.length}.`,
      );
    }
    return Object.fromEntries(CAMPOS.map((c, i) => [c, valores[i].trim()]));
  });
}

// Compara sin distinguir mayúsculas, acentos ni espacios repetidos.
function normalizar(texto) {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// --- Esquemas ---------------------------------------------------------------

const servidorSchema = z.object(
  Object.fromEntries(CAMPOS.map((c) => [c, z.string().describe(DESCRIPCION_CAMPOS[c])])),
);
const totalSchema = z.number().int().describe('Número de servidores encontrados');
const servidoresSchema = z.array(servidorSchema).describe('Servidores encontrados, en el orden del CSV');

const textoEntrada = (descripcion) =>
  z.string().trim().min(1, 'No puede ir vacío').max(LARGO_MAXIMO).describe(descripcion);

// --- Respuestas -------------------------------------------------------------

function resultado(datos) {
  return {
    content: [{ type: 'text', text: JSON.stringify(datos, null, 2) }],
    structuredContent: datos,
  };
}

function fallo(mensaje) {
  return { content: [{ type: 'text', text: mensaje }], isError: true };
}

// Envuelve cada herramienta: un error esperado se explica; uno inesperado no expone detalles.
function protegida(manejador) {
  return async (args) => {
    try {
      return await manejador(args);
    } catch (e) {
      if (e instanceof ErrorInventario) return fallo(e.message);
      console.error('[mcp-inventario] error inesperado:', e);
      return fallo('Error interno al consultar el inventario.');
    }
  };
}

const SOLO_LECTURA = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

// --- Servidor ---------------------------------------------------------------

const servidor = new McpServer({ name: 'inventario-csv', version: '1.0.0' });

servidor.registerTool(
  'buscar_servidor',
  {
    title: 'Buscar servidor en el inventario',
    description:
      'Busca servidores en el inventario de TI (docs/inventario-servidores.csv, datos ficticios). ' +
      'Regresa los servidores en los que el texto aparece dentro de CUALQUIER columna: ' +
      `${CAMPOS.join(', ')}. ` +
      'No distingue mayúsculas ni acentos y acepta coincidencias parciales: ' +
      '"prod" encuentra los servidores de produccion, "postgres" las bases de datos y "debian" los Debian 12. ' +
      'Para filtrar por una sola columna con un valor exacto, usa servidores_por. Solo lectura.',
    inputSchema: {
      texto: textoEntrada(
        `Texto a buscar (1 a ${LARGO_MAXIMO} caracteres), por ejemplo "prod", "postgres" o "Equipo Datos"`,
      ),
    },
    outputSchema: { total: totalSchema, servidores: servidoresSchema },
    annotations: SOLO_LECTURA,
  },
  protegida(async ({ texto }) => {
    const buscado = normalizar(texto);
    const servidores = (await leerInventario()).filter((s) =>
      CAMPOS.some((c) => normalizar(s[c]).includes(buscado)),
    );
    return resultado({ total: servidores.length, servidores });
  }),
);

servidor.registerTool(
  'servidores_por',
  {
    title: 'Servidores por campo',
    description:
      'Lista los servidores del inventario de TI (docs/inventario-servidores.csv, datos ficticios) ' +
      'cuyo campo es IGUAL al valor dado. No distingue mayúsculas, acentos ni espacios de más, ' +
      'pero el valor debe ser completo: "RHEL 9.2" sí, "RHEL" no (para coincidencias parciales usa buscar_servidor). ' +
      'Si no hay resultados, regresa valores_disponibles con los valores que existen en ese campo. ' +
      'Campos: ' +
      CAMPOS.map((c) => `${c} = ${DESCRIPCION_CAMPOS[c]}`).join('; ') +
      '. Solo lectura.',
    inputSchema: {
      campo: z.enum(CAMPOS).describe(`Columna por la que se filtra: ${CAMPOS.join(', ')}`),
      valor: textoEntrada(
        `Valor completo que debe tener el campo (1 a ${LARGO_MAXIMO} caracteres), por ejemplo "produccion" o "RHEL 9.2"`,
      ),
    },
    outputSchema: {
      total: totalSchema,
      servidores: servidoresSchema,
      valores_disponibles: z
        .array(z.string())
        .optional()
        .describe('Solo si no hubo resultados: valores distintos que existen en ese campo'),
    },
    annotations: SOLO_LECTURA,
  },
  protegida(async ({ campo, valor }) => {
    const buscado = normalizar(valor);
    const inventario = await leerInventario();
    const servidores = inventario.filter((s) => normalizar(s[campo]) === buscado);
    if (servidores.length > 0) return resultado({ total: servidores.length, servidores });
    const valores_disponibles = [...new Set(inventario.map((s) => s[campo]))].sort();
    return resultado({ total: 0, servidores: [], valores_disponibles });
  }),
);

await servidor.connect(new StdioServerTransport());

// Aviso temprano en stderr si el CSV no se puede usar (el servidor sigue arriba).
leerInventario().then(
  (inv) => console.error(`[mcp-inventario] listo por stdio: ${inv.length} servidores en ${NOMBRE_CSV}`),
  (e) => console.error(`[mcp-inventario] aviso: ${e.message}`),
);
